import {
  mingxingshuoContractSubject,
  normalizeClaimedTaskConfig,
  normalizeContractSubject,
  type ServiceConfig,
} from "../shared/config.js";
import { createLogger, runWithLogContext } from "../shared/logger.js";
import { validateLocalEpisodeVideos } from "../shared/local-episode-videos.js";
import { FeishuNotifier } from "@drama/feishu-notifier";
import {
  claimNextTaskForVideoAccountApi,
  reportClaimedTaskErrorApi,
  reportClaimedTaskSuccessApi,
} from "../api/task.js";
import type { VideoAccount } from "../api/video-accounts.js";
import { BrowserContextManager } from "../automation/browser-context-manager.js";
import { TaskService } from "./task-service.js";
import { classifyError, ErrorType, inferRpaFailStage } from "../shared/errors.js";
import { getWechatVideoRuntimeSettings } from "../shared/runtime-settings.js";
import { integerSetting } from "../shared/settings-value.js";
import type { EnsureBaiduNetdiskResource } from "./runtime.js";
import {
  prepareWechatProductionProofMaterials,
  wechatOwnershipRequirements,
} from "../shared/production-proof-materials.js";
import { prepareWechatPosterMaterials } from "../shared/poster-materials.js";
import {
  prepareWechatAiProductionProofMaterials,
  wechatAiProductionProofRequirements,
} from "../shared/ai-production-proof-materials.js";

const logger = createLogger("worker");
const claimErrorDelayMs = 10000;
const loginRequiredDelayMs = 30 * 60_000;
const baiduNetdiskDownloadRetryDelayMs = 5000;
const nonRetryableBaiduNetdiskErrorPatterns = [
  "百度网盘账号登录已过期",
  "账户已过期",
  "重新登录",
  "重新登陆",
  "百度网盘权属材料数量不足",
  "百度网盘海报封面数量不足",
  "百度网盘AI制作证明数量不足",
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface AccountWorkerControl {
  videoAccount: VideoAccount;
  stopped: boolean;
  promise: Promise<void>;
}

export class TaskWorkerPool {
  private stopped = true;
  private readonly accountWorkersByVideoAccountId = new Map<string, AccountWorkerControl>();

  constructor(
    private readonly serviceConfig: ServiceConfig,
    private readonly browserContexts: BrowserContextManager,
    private readonly taskService: TaskService,
    private readonly notifier = new FeishuNotifier(),
    private readonly ensureBaiduNetdiskResource?: EnsureBaiduNetdiskResource,
  ) {}

  start(): void {
    if (!this.stopped) return;

    this.stopped = false;

    for (const videoAccount of this.serviceConfig.videoAccounts) {
      this.addAccountWorker(videoAccount);
    }
  }

  stop(): void {
    this.stopped = true;
    for (const worker of this.accountWorkersByVideoAccountId.values()) {
      worker.stopped = true;
    }
  }

  syncVideoAccounts(videoAccounts: VideoAccount[]): void {
    const nextAccountIds = new Set(videoAccounts.map((account) => account.id));

    for (const [videoAccountId, worker] of this.accountWorkersByVideoAccountId) {
      if (!nextAccountIds.has(videoAccountId)) {
        worker.stopped = true;
        logger.info("stopping removed worker", {
          videoAccountId,
          videoAccountName: worker.videoAccount.name,
        });
      }
    }

    for (const videoAccount of videoAccounts) {
      this.addAccountWorker(videoAccount);
    }
  }

  private addAccountWorker(videoAccount: VideoAccount): void {
    const existingWorker = this.accountWorkersByVideoAccountId.get(videoAccount.id);
    if (existingWorker) {
      existingWorker.videoAccount = videoAccount;
      if (existingWorker.stopped && !this.stopped) {
        existingWorker.stopped = false;
        logger.info("resuming worker", {
          videoAccountId: videoAccount.id,
          videoAccountName: videoAccount.name,
        });
      }
      return;
    }

    if (this.stopped) return;

    const worker: AccountWorkerControl = {
      videoAccount,
      stopped: false,
      promise: Promise.resolve(),
    };
    worker.promise = this.runAccountWorker(worker).finally(() => {
      if (this.accountWorkersByVideoAccountId.get(videoAccount.id) === worker) {
        this.accountWorkersByVideoAccountId.delete(videoAccount.id);
      }
    });
    this.accountWorkersByVideoAccountId.set(videoAccount.id, worker);
  }

  private async runAccountWorker(worker: AccountWorkerControl): Promise<void> {
    return runWithLogContext({
      videoAccountId: worker.videoAccount.id,
      videoAccountName: worker.videoAccount.name,
    }, async () => {
    const videoAccountId = worker.videoAccount.id;
    let consecutiveEmptyClaims = 0;
    let nextLoginCheckAt = 0;
    let lastBusyLogKey = "";
    let lastBusyLoggedAt = 0;
    logger.info("worker started", { videoAccountId });

    while (!this.stopped && !worker.stopped) {
      const videoAccount = worker.videoAccount;
      try {
        const reservation = this.taskService.tryReserveChannel(videoAccountId, "worker-claim");
        if (!reservation) {
          const busyState = this.taskService.getChannelBusyState(videoAccountId);
          const busyLogKey = busyState
            ? `${busyState.kind}:${busyState.label}:${
                busyState.kind === "task" ? busyState.accountTaskId ?? "-" : "-"
              }`
            : "unknown";
          if (busyLogKey !== lastBusyLogKey || Date.now() - lastBusyLoggedAt >= 30_000) {
            logger.info("skip claim, channel busy", {
              videoAccountId,
              videoAccountName: videoAccount.name,
              busyKind: busyState?.kind ?? "unknown",
              busyLabel: busyState?.label ?? "unknown",
              busySince: busyState?.busySince,
              busyDurationMs: busyState?.busyDurationMs,
              busyAccountTaskId: busyState?.kind === "task"
                ? busyState.accountTaskId
                : undefined,
              busyOriginalTitle: busyState?.kind === "task"
                ? busyState.originalTitle
                : undefined,
              busyTaskStatus: busyState?.kind === "task"
                ? busyState.status
                : undefined,
            });
            lastBusyLogKey = busyLogKey;
            lastBusyLoggedAt = Date.now();
          }
          await sleep(1000);
          continue;
        }
        lastBusyLogKey = "";
        lastBusyLoggedAt = 0;

        try {
          if (Date.now() >= nextLoginCheckAt) {
            const loggedIn = await this.browserContexts.refreshLoginStateInTemporaryPage(
              videoAccountId,
              this.serviceConfig.idlePageRefresh.timeoutMs,
            );
            if (!loggedIn) {
              logger.info("skip claim, login required", {
                videoAccountId,
                videoAccountName: videoAccount.name,
                loginWaitTimeoutMs: loginRequiredDelayMs,
              });
              reservation.release();
              const loginCompleted = await this.browserContexts.waitForAuthenticatedSession(
                videoAccountId,
                loginRequiredDelayMs,
              );
              if (loginCompleted) {
                logger.info("login detected, retry claim immediately", {
                  videoAccountId,
                  videoAccountName: videoAccount.name,
                });
              } else {
                logger.info("login wait timed out, retry login check", {
                  videoAccountId,
                  videoAccountName: videoAccount.name,
                });
              }
              continue;
            }
            nextLoginCheckAt = Date.now() + loginRequiredDelayMs;
          }

          logger.info("claiming task", {
            videoAccountId,
            videoAccountName: videoAccount.name,
          });
          try {
            const claimedAccountTask = await claimNextTaskForVideoAccountApi(videoAccount);
          // debugger
          if (!claimedAccountTask) {
            consecutiveEmptyClaims += 1;
            const retryDelayMs = consecutiveEmptyClaims >= this.serviceConfig.worker.slowEmptyClaimThreshold
              ? this.serviceConfig.worker.slowEmptyClaimDelayMs
              : this.serviceConfig.worker.emptyClaimDelayMs;
            logger.info("no task, retry later", {
              videoAccountId,
              emptyClaimCount: consecutiveEmptyClaims,
              retryDelayMs,
            });
            reservation.release();
            await sleep(retryDelayMs);
            continue;
          }

          consecutiveEmptyClaims = 0;

          try {
            const playletConfig = normalizeClaimedTaskConfig(
              claimedAccountTask,
              videoAccount.contractSubject,
            );
            logger.info("verify login before task execution", {
              accountTaskId: claimedAccountTask.accountTaskId,
              videoAccountId,
            });
            const stillLoggedIn = await this.browserContexts.refreshLoginStateInTemporaryPage(
              videoAccountId,
              this.serviceConfig.idlePageRefresh.timeoutMs,
            );
            if (!stillLoggedIn) {
              nextLoginCheckAt = 0;
              throw Object.assign(
                new Error(`微信视频号账号未登录，停止执行任务：${videoAccount.name}`),
                {
                  errorType: ErrorType.Authentication,
                  failStage: "LOGIN" as const,
                },
              );
            }
            await prepareWechatAiProductionProofMaterials(playletConfig, { allowMissing: true });
            await this.ensureBaiduNetdiskResourceReady(videoAccount, claimedAccountTask, playletConfig);
            await validateLocalEpisodeVideos(playletConfig);
            await prepareWechatPosterMaterials(playletConfig);
            const aiProductionProofFiles = await prepareWechatAiProductionProofMaterials(playletConfig);
            logger.info("AI production proof materials ready", {
              accountTaskId: claimedAccountTask.accountTaskId,
              enabled: playletConfig.playlet.aiContent ?? true,
              files: aiProductionProofFiles,
            });
            const productionProofFiles = await prepareWechatProductionProofMaterials(
              playletConfig,
              videoAccount.contractSubject,
            );
            logger.info("production proof materials ready", {
              accountTaskId: claimedAccountTask.accountTaskId,
              contractSubject: videoAccount.contractSubject,
              strategy: videoAccount.contractSubject
                && normalizeContractSubject(videoAccount.contractSubject) === mingxingshuoContractSubject
                ? "mingxingshuo-random-ownership"
                : "contract-and-ownership",
              files: productionProofFiles,
            });

            const { taskRecord, taskFinished } = await this.taskService.createTaskFromClaim(
              videoAccountId,
              claimedAccountTask,
              playletConfig,
              reservation,
            );
            reservation.release();
            logger.info("claimed task record created", {
              accountTaskId: claimedAccountTask.accountTaskId,
              dramaId: claimedAccountTask.dramaId,
              videoAccountId: taskRecord.channelId,
              originalTitle: claimedAccountTask.originalTitle,
            });

            await taskFinished;
            await reportClaimedTaskSuccessApi({
              accountTaskId: claimedAccountTask.accountTaskId,
            });
            await this.notifier.notifyTaskSucceeded({
              accountTaskId: claimedAccountTask.accountTaskId,
              dramaId: claimedAccountTask.dramaId,
              originalTitle: claimedAccountTask.originalTitle,
              videoAccountId,
              videoAccountName: videoAccount.name,
            });
            logger.info("task finished, continue claim loop", {
              accountTaskId: claimedAccountTask.accountTaskId,
              videoAccountId,
            });
          } catch (error) {
            const errorInfo = classifyError(error, ErrorType.TaskExecution);
            if (errorInfo.type === ErrorType.Interrupted) {
              logger.warn("task interrupted, skip failure callback", {
                accountTaskId: claimedAccountTask.accountTaskId,
                videoAccountId,
                errorType: errorInfo.type,
                errorMessage: errorInfo.message,
                runtimeStopping: this.stopped,
                workerStopping: worker.stopped,
              });
              continue;
            }
            const taskErrorMessage = errorInfo.message;
            await reportClaimedTaskErrorApi({
              accountTaskId: claimedAccountTask.accountTaskId,
              dramaId: claimedAccountTask.dramaId,
              failStage: inferRpaFailStage(errorInfo.type, errorInfo.failStage),
              resultJson: {
                errorType: errorInfo.type,
              },
              videoAccountId,
              errorMessage: taskErrorMessage,
            });
            await this.notifier.notifyTaskFailed({
              accountTaskId: claimedAccountTask.accountTaskId,
              dramaId: claimedAccountTask.dramaId,
              originalTitle: claimedAccountTask.originalTitle,
              videoAccountId,
              videoAccountName: videoAccount.name,
              errorMessage: taskErrorMessage,
              errorType: errorInfo.type,
            }).catch((notificationError) => {
              logger.error("task failure notification failed after backend callback", {
                accountTaskId: claimedAccountTask.accountTaskId,
                videoAccountId,
                errorMessage:
                  notificationError instanceof Error
                    ? notificationError.message
                    : String(notificationError),
              });
            });
            logger.error("task failed, continue claim loop", {
              accountTaskId: claimedAccountTask.accountTaskId,
              videoAccountId,
              errorType: errorInfo.type,
              errorMessage: errorInfo.message,
            });
          }
          } finally {
            reservation.release();
          }
        } finally {
          reservation.release();
        }
      } catch (error) {
        const errorInfo = classifyError(error, ErrorType.TaskClaim);
        logger.error("claim loop error", {
          videoAccountId,
          errorType: errorInfo.type,
          errorMessage: errorInfo.message,
        });
        await sleep(claimErrorDelayMs);
      }
    }

    logger.info("worker stopped", { videoAccountId });
    });
  }

  private async ensureBaiduNetdiskResourceReady(
    videoAccount: VideoAccount,
    claimedAccountTask: Awaited<ReturnType<typeof claimNextTaskForVideoAccountApi>>,
    playletConfig: ReturnType<typeof normalizeClaimedTaskConfig>,
  ): Promise<void> {
    if (!claimedAccountTask) return;

    const baiduPanResourceLink = stringValue(claimedAccountTask.playlet.baiduPanResourceLink);
    if (!baiduPanResourceLink) return;

    if (!this.ensureBaiduNetdiskResource) {
      throw new Error("任务包含百度网盘资源链接，但当前运行时未接入百度网盘下载能力。");
    }

    logger.info("ensure baidu netdisk resource before task", {
      accountTaskId: claimedAccountTask.accountTaskId,
      originalTitle: claimedAccountTask.originalTitle,
      baiduPanResourceLink,
    });

    const settings = getWechatVideoRuntimeSettings();
    const retryAttempts = integerSetting(settings.baiduNetdiskDownloadRetryAttempts, 3);
    const maxAttempts = retryAttempts + 1;
    const isMingxingshuo = Boolean(
      videoAccount.contractSubject
      && normalizeContractSubject(videoAccount.contractSubject) === mingxingshuoContractSubject,
    );
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        logger.info("baidu netdisk resource attempt", {
          accountTaskId: claimedAccountTask.accountTaskId,
          originalTitle: claimedAccountTask.originalTitle,
          attempt,
          maxAttempts,
        });

        await this.ensureBaiduNetdiskResource({
          shareText: baiduPanResourceLink,
          resourceName: claimedAccountTask.originalTitle,
          localEpisodeVideoRoot: settings.localEpisodeVideoRoot,
          episodeCount: playletConfig.playlet.episodeCount,
          requiredOwnership: wechatOwnershipRequirements,
          requiredPosterImages: 1,
          requiredAiProductionProofFiles:
            (playletConfig.playlet.aiContent ?? true)
            && !(playletConfig.playlet.aiProductionProofFiles?.length)
              ? wechatAiProductionProofRequirements.minimumFiles
              : 0,
          mergeOwnershipMaterials: !isMingxingshuo && !["false", "0", "no", "off"].includes(
            String(settings.mergeOwnershipMaterials ?? "true").trim().toLowerCase(),
          ),
        });

        logger.info("baidu netdisk resource ready", {
          accountTaskId: claimedAccountTask.accountTaskId,
          originalTitle: claimedAccountTask.originalTitle,
          attempt,
        });
        return;
      } catch (error) {
        lastError = error;
        const errorMessage = error instanceof Error ? error.message : String(error);
        const nonRetryable = nonRetryableBaiduNetdiskErrorPatterns.some((pattern) =>
          errorMessage.includes(pattern),
        );

        if (nonRetryable || attempt >= maxAttempts) {
          logger.error(nonRetryable ? "baidu netdisk resource failed without retry" : "baidu netdisk resource failed after retries", {
            accountTaskId: claimedAccountTask.accountTaskId,
            originalTitle: claimedAccountTask.originalTitle,
            attempt,
            maxAttempts,
            nonRetryable,
            errorMessage,
          });
          break;
        }

        logger.warn("baidu netdisk resource failed, retry", {
          accountTaskId: claimedAccountTask.accountTaskId,
          originalTitle: claimedAccountTask.originalTitle,
          attempt,
          nextAttempt: attempt + 1,
          maxAttempts,
          retryDelayMs: baiduNetdiskDownloadRetryDelayMs,
          errorMessage,
        });
        await sleep(baiduNetdiskDownloadRetryDelayMs);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
