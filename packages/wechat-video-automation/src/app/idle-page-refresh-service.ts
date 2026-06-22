import { BrowserContextManager } from "../automation/browser-context-manager.js";
import type { ServiceConfig } from "../shared/config.js";
import { createLogger, runWithLogContext } from "../shared/logger.js";
import { TaskService } from "./task-service.js";

const logger = createLogger("idle-refresh");

export class IdlePageRefreshService {
  private stopped = true;
  private readonly timersByChannelId = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly serviceConfig: ServiceConfig,
    private readonly browserContexts: BrowserContextManager,
    private readonly taskService: TaskService,
  ) {}

  start(): void {
    if (!this.stopped || this.serviceConfig.idlePageRefresh.intervalMs <= 0) return;

    this.stopped = false;
    this.syncVideoAccounts();
    logger.info(
      `started intervalMs=${this.serviceConfig.idlePageRefresh.intervalMs} ` +
      `timeoutMs=${this.serviceConfig.idlePageRefresh.timeoutMs} ` +
      `jitterMs=${this.serviceConfig.idlePageRefresh.jitterMs}`,
    );
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timersByChannelId.values()) {
      clearTimeout(timer);
    }
    this.timersByChannelId.clear();
  }

  syncVideoAccounts(): void {
    if (this.stopped || this.serviceConfig.idlePageRefresh.intervalMs <= 0) return;

    const channelIds = new Set(this.browserContexts.list().map((channel) => channel.channelId));
    for (const [channelId, timer] of this.timersByChannelId) {
      if (!channelIds.has(channelId)) {
        clearTimeout(timer);
        this.timersByChannelId.delete(channelId);
        logger.info(`stopped removed channelId=${channelId}`);
      }
    }

    for (const channelId of channelIds) {
      if (!this.timersByChannelId.has(channelId)) {
        this.schedule(channelId, this.serviceConfig.idlePageRefresh.intervalMs + this.randomDelayMs());
      }
    }
  }

  private schedule(channelId: string, delayMs: number): void {
    const timer = setTimeout(() => {
      this.timersByChannelId.delete(channelId);
      void this.refreshAndReschedule(channelId);
    }, delayMs);
    this.timersByChannelId.set(channelId, timer);
  }

  private async refreshAndReschedule(channelId: string): Promise<void> {
    try {
      if (!this.stopped && this.browserContexts.has(channelId)) {
        await this.refreshChannel(channelId);
      }
    } finally {
      if (!this.stopped && this.browserContexts.has(channelId)) {
        this.schedule(channelId, this.serviceConfig.idlePageRefresh.intervalMs + this.randomDelayMs());
      }
    }
  }

  private async refreshChannel(channelId: string): Promise<void> {
    return runWithLogContext({
      videoAccountId: channelId,
      videoAccountName: this.browserContexts.getVideoAccountName(channelId),
    }, async () => {
    const reservation = this.taskService.tryReserveChannel(channelId, "idle-page-refresh");
    if (!reservation) {
      logger.info(`skip busy channelId=${channelId} name=${this.browserContexts.getVideoAccountName(channelId)}`);
      return;
    }

    try {
      await this.browserContexts.refreshLoginStateInTemporaryPage(
        channelId,
        this.serviceConfig.idlePageRefresh.timeoutMs,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`failed channelId=${channelId} name=${this.browserContexts.getVideoAccountName(channelId)} ${message}`);
    } finally {
      reservation.release();
    }
    });
  }

  private randomDelayMs(): number {
    const jitterMs = this.serviceConfig.idlePageRefresh.jitterMs;
    return jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
  }
}
