import { fetchVideoAccountsApi, type VideoAccount } from "../api/video-accounts.js";
import { BrowserContextManager } from "../automation/browser-context-manager.js";
import { createLogger } from "../shared/logger.js";
import type { ServiceConfig } from "../shared/config.js";
import { TaskWorkerPool } from "./task-worker-pool.js";

const logger = createLogger("video-account-sync");

export class VideoAccountSyncService {
  private timer: NodeJS.Timeout | undefined;
  private syncing = false;

  constructor(
    private readonly serviceConfig: ServiceConfig,
    private readonly browserContexts: BrowserContextManager,
    private readonly taskWorkerPool: TaskWorkerPool,
    private readonly idlePageRefreshService?: { syncVideoAccounts(): void },
  ) {}

  start(): void {
    if (this.timer || this.serviceConfig.videoAccountSync.intervalMs <= 0) return;

    this.timer = setInterval(() => {
      void this.sync().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`sync failed: ${message}`);
      });
    }, this.serviceConfig.videoAccountSync.intervalMs);
    logger.info(`started intervalMs=${this.serviceConfig.videoAccountSync.intervalMs}`);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async sync(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;

    try {
      const videoAccounts = await fetchVideoAccountsApi();
      this.validateVideoAccounts(videoAccounts);
      const changes = this.browserContexts.syncVideoAccounts(videoAccounts);
      this.taskWorkerPool.syncVideoAccounts(videoAccounts);
      this.serviceConfig.videoAccounts = videoAccounts;
      this.idlePageRefreshService?.syncVideoAccounts();

      if (changes.added.length || changes.removed.length || changes.renamed.length) {
        logger.info(
          `changed added=${changes.added.map((account) => `${account.id}/${account.name}`).join(",") || "-"} ` +
          `removed=${changes.removed.map((account) => `${account.id}/${account.name}`).join(",") || "-"} ` +
          `renamed=${changes.renamed.map((change) => `${change.previous.id}/${change.previous.name}->${change.next.name}`).join(",") || "-"}`,
        );
      }
    } finally {
      this.syncing = false;
    }
  }

  private validateVideoAccounts(videoAccounts: VideoAccount[]): void {
    const accountIds = videoAccounts.map((account) => account.id);
    if (new Set(accountIds).size !== accountIds.length) {
      throw new Error("Video account list must not contain duplicate account ids.");
    }
    if (videoAccounts.some((account) => !account.id || !account.name)) {
      throw new Error("Video account id and name are required.");
    }
  }
}
