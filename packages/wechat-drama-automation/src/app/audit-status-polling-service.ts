import type { Page } from "playwright";
import { FeishuNotifier } from "@drama/feishu-notifier";
import {
  fetchPendingAuditAccountTasksApi,
  updateAccountTaskAuditStatusApi,
  type AccountTaskPageItem,
  type AuditStatus,
} from "../api/task.js";
import type { VideoAccount } from "../api/video-accounts.js";
import { BrowserContextManager } from "../automation/browser-context-manager.js";
import { nativeDramaListUrl, playletUrl } from "../automation/constants.js";
import {
  mingxingshuoContractSubject,
  normalizeContractSubject,
  type ServiceConfig,
} from "../shared/config.js";
import { createLogger, runWithLogContext } from "../shared/logger.js";
import { TaskService } from "./task-service.js";

const logger = createLogger("audit-status-polling");
// 微信枚举中 Init(1) 按业务规则视为审核通过；AuditPass(3) 和 Online(6)
// 同样已经越过审核门槛。只有明确的失败态才回写 REJECTED。
const approvedDramaStatuses = new Set([1, 3, 6]);
const rejectedDramaStatuses = new Set([4, 10, 12]);
const busyRetryDelayMs = 5000;
const loginRetryDelayMs = 1.5 * 60 * 60_000;

interface NativeDramaItem {
  dramaName?: string;
  dramaStatus?: number;
  dramaUuid?: string;
}

interface NativeDramaListResponse {
  errCode?: number;
  errMsg?: string;
  data?: {
    list?: NativeDramaItem[];
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function taskDramaName(task: AccountTaskPageItem): string {
  return task.selectedTitle?.trim() || task.originalTitle?.trim() || "";
}

function normalizeDramaName(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function auditStatusFromDramaStatus(
  dramaStatus: number | undefined,
): Extract<AuditStatus, "APPROVED" | "REJECTED"> | null {
  if (dramaStatus !== undefined && approvedDramaStatuses.has(dramaStatus)) return "APPROVED";
  if (dramaStatus !== undefined && rejectedDramaStatuses.has(dramaStatus)) return "REJECTED";
  return null;
}

export class AuditStatusPollingService {
  private timer: NodeJS.Timeout | undefined;
  private stopped = true;
  private running = false;

  constructor(
    private readonly serviceConfig: ServiceConfig,
    private readonly browserContexts: BrowserContextManager,
    private readonly taskService: TaskService,
    private readonly notifier = new FeishuNotifier(),
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.runCycle();
    logger.info("started", {
      taskDelayMs: this.serviceConfig.auditStatusPolling.taskDelayMs,
      intervalMs: this.serviceConfig.auditStatusPolling.intervalMs,
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  syncVideoAccounts(): void {
    if (!this.stopped && !this.running && !this.timer) this.schedule(0);
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.runCycle();
    }, delayMs);
  }

  private async runCycle(): Promise<void> {
    if (this.stopped || this.running) return;
    this.running = true;
    let nextCycleDelayMs = this.serviceConfig.auditStatusPolling.intervalMs;

    try {
      const accounts = this.serviceConfig.videoAccounts.filter((account) => (
        account.contractSubject
          ? normalizeContractSubject(account.contractSubject) === mingxingshuoContractSubject
          : false
      ));
      logger.info("cycle started", {
        mingxingshuoAccountCount: accounts.length,
        videoAccountIds: accounts.map((account) => account.id),
      });
      const accountResults = await Promise.all(accounts.map((account) => runWithLogContext({
        videoAccountId: account.id,
        videoAccountName: account.name,
      }, async () => {
        try {
          return await this.pollAccount(account);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.warn("account polling failed", {
            videoAccountId: account.id,
            videoAccountName: account.name,
            errorMessage,
          });
          await this.notifier.notifyAuditStatusFailed({
            videoAccountId: account.id,
            videoAccountName: account.name,
            errorMessage,
          });
          return true;
        }
      })));
      if (accountResults.some((completed) => !completed)) {
        nextCycleDelayMs = loginRetryDelayMs;
      }
      logger.info("cycle completed", {
        mingxingshuoAccountCount: accounts.length,
        loginPendingAccountCount: accountResults.filter((completed) => !completed).length,
        nextCycleDelayMs,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn("cycle failed", { errorMessage });
      await this.notifier.notifyAuditStatusFailed({ errorMessage });
    } finally {
      this.running = false;
      if (!this.stopped) {
        this.schedule(Math.max(60_000, nextCycleDelayMs));
      }
    }
  }

  private async pollAccount(account: VideoAccount): Promise<boolean> {
    logger.info("account polling started", {
      videoAccountId: account.id,
      videoAccountName: account.name,
    });
    let reservation = this.taskService.tryReserveChannel(account.id, "audit-status-polling");
    while (!reservation && !this.stopped) {
      logger.info("skip busy account; retry soon", { retryDelayMs: busyRetryDelayMs });
      await sleep(busyRetryDelayMs);
      reservation = this.taskService.tryReserveChannel(account.id, "audit-status-polling");
    }
    if (!reservation) return false;

    try {
      logger.info("check mingxingshuo login before audit polling");
      const loggedIn = await this.browserContexts.refreshLoginStateInTemporaryPage(
        account.id,
        this.serviceConfig.idlePageRefresh.timeoutMs,
      );
      if (!loggedIn) {
        logger.info("audit polling skipped; mingxingshuo login required", {
          retryDelayMs: loginRetryDelayMs,
        });
        return false;
      }
      logger.info("mingxingshuo login ready; fetch pending audit tasks");
      const tasks = await fetchPendingAuditAccountTasksApi(account);
      logger.info("pending audit tasks ready", {
        pendingCount: tasks.length,
        accountTaskIds: tasks.map((task) => task.id),
      });
      if (tasks.length === 0) {
        await this.notifier.notifyAuditStatusCycleCompleted({
          videoAccountId: account.id,
          videoAccountName: account.name,
          pendingCount: 0,
          summary: "本轮没有需要查询的明星说审核任务",
        });
        return true;
      }

      const context = await this.browserContexts.getOrLaunch(account.id);
      const page = await context.newPage();
      let succeededCount = 0;
      let failedCount = 0;
      try {
        await page.goto(playletUrl, { waitUntil: "domcontentloaded" });
        for (let index = 0; index < tasks.length && !this.stopped; index += 1) {
          const succeeded = await this.pollTask(page, tasks[index], account);
          if (succeeded) succeededCount += 1;
          else failedCount += 1;
          if (index < tasks.length - 1 && !this.stopped) {
            await sleep(Math.max(1000, this.serviceConfig.auditStatusPolling.taskDelayMs));
          }
        }
      } finally {
        await page.close({ runBeforeUnload: false }).catch(() => undefined);
      }
      logger.info("account polling completed", {
        pendingCount: tasks.length,
        succeededCount,
        failedCount,
      });
      await this.notifier.notifyAuditStatusCycleCompleted({
        videoAccountId: account.id,
        videoAccountName: account.name,
        pendingCount: tasks.length,
        summary: `查询成功 ${succeededCount} 条，失败 ${failedCount} 条`,
      });
      return true;
    } finally {
      reservation.release();
    }
  }

  private async pollTask(
    page: Page,
    task: AccountTaskPageItem,
    account: VideoAccount,
  ): Promise<boolean> {
    const queryString = taskDramaName(task);
    logger.info("task audit status query started", {
      accountTaskId: task.id,
      queryString,
      currentAuditStatus: task.auditStatus,
    });
    try {
      const response = await page.evaluate(async ({ url, query }) => {
        const result = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          referrer: "https://channels.weixin.qq.com/micro/content/playlet/",
          body: JSON.stringify({
            pageSize: 10,
            currentPage: 1,
            queryString: query,
            _log_finder_uin: "",
            rawKeyBuff: "",
            pluginSessionId: null,
            scene: 7,
            reqScene: 7,
          }),
          credentials: "include",
        });
        if (!result.ok) throw new Error(`HTTP ${result.status}`);
        return result.json() as Promise<NativeDramaListResponse>;
      }, { url: nativeDramaListUrl, query: queryString });

      if (response.errCode !== 0) {
        throw new Error(response.errMsg || `errCode=${response.errCode ?? "unknown"}`);
      }
      const exactDrama = response.data?.list?.find((drama) => (
        normalizeDramaName(drama.dramaName) === normalizeDramaName(queryString)
      ));
      if (!exactDrama) {
        logger.info("native drama exact match not found", {
          accountTaskId: task.id,
          queryString,
          resultNames: response.data?.list?.map((drama) => drama.dramaName).filter(Boolean) ?? [],
        });
        await this.notifier.notifyAuditStatusFailed({
          accountTaskId: task.id,
          dramaId: task.dramaId,
          originalTitle: task.originalTitle,
          selectedTitle: queryString,
          videoAccountId: account.id,
          videoAccountName: account.name,
          errorMessage: "微信平台未找到剧名完全一致的剧目",
        });
        return false;
      }

      const auditStatus = auditStatusFromDramaStatus(exactDrama.dramaStatus);
      logger.info("native drama status queried", {
        accountTaskId: task.id,
        queryString,
        dramaUuid: exactDrama.dramaUuid,
        dramaStatus: exactDrama.dramaStatus,
        auditStatus,
      });
      if (!auditStatus) {
        await this.notifier.notifyAuditStatusResult({
          accountTaskId: task.id,
          dramaId: task.dramaId,
          originalTitle: task.originalTitle,
          selectedTitle: queryString,
          videoAccountId: account.id,
          videoAccountName: account.name,
          dramaStatus: exactDrama.dramaStatus,
          summary: "微信状态仍在处理中，本轮不回写后端",
        });
        return true;
      }

      await updateAccountTaskAuditStatusApi(task.id, auditStatus);
      logger.info("task audit status query and update succeeded", {
        accountTaskId: task.id,
        queryString,
        dramaStatus: exactDrama.dramaStatus,
        auditStatus,
      });
      await this.notifier.notifyAuditStatusResult({
        accountTaskId: task.id,
        dramaId: task.dramaId,
        originalTitle: task.originalTitle,
        selectedTitle: queryString,
        videoAccountId: account.id,
        videoAccountName: account.name,
        dramaStatus: exactDrama.dramaStatus,
        auditStatus,
        summary: "微信审核状态已成功回写后端",
      });
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn("task audit status query failed", {
        accountTaskId: task.id,
        queryString,
        errorMessage,
      });
      await this.notifier.notifyAuditStatusFailed({
        accountTaskId: task.id,
        dramaId: task.dramaId,
        originalTitle: task.originalTitle,
        selectedTitle: queryString,
        videoAccountId: account.id,
        videoAccountName: account.name,
        errorMessage,
      });
      return false;
    }
  }
}
