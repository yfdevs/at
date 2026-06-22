import { BrowserContextManager } from "../automation/browser-context-manager.js";
import { runPlayletTask } from "../automation/playlet-runner.js";
import type { ClaimedAccountTask, Config, TaskRecord, TaskRunOptions } from "../shared/types.js";
import { createLogger, type LogContext, runWithLogContext } from "../shared/logger.js";
import { FeishuNotifier } from "../shared/feishu-notifier.js";
import { classifyError, ErrorType } from "../shared/errors.js";

const logger = createLogger("task");

export interface ChannelReservation {
  readonly channelId: string;
  readonly label: string;
  readonly token: symbol;
  release(): void;
}

export class TaskService {
  private readonly taskRecordsByKey = new Map<string, TaskRecord>();

  private readonly activeTaskKeyByChannelId = new Map<string, string>();
  private readonly channelReservationsById = new Map<string, ChannelReservation>();

  constructor(
    private readonly browserContexts: BrowserContextManager,
    private readonly notifier = new FeishuNotifier(),
  ) {}

  list(): TaskRecord[] {
    return Array.from(this.taskRecordsByKey.values()).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  get(accountTaskId: string | number): TaskRecord | undefined {
    return this.taskRecordsByKey.get(this.formatAccountTaskKey(accountTaskId));
  }

  isBusy(channelId?: string): boolean {
    return channelId
      ? this.activeTaskKeyByChannelId.has(channelId) || this.channelReservationsById.has(channelId)
      : this.activeTaskKeyByChannelId.size > 0 || this.channelReservationsById.size > 0;
  }

  tryReserveChannel(channelId: string, label: string): ChannelReservation | null {
    if (!this.browserContexts.has(channelId)) {
      throw new Error(`Unknown channelId: ${channelId}`);
    }
    if (this.activeTaskKeyByChannelId.has(channelId) || this.channelReservationsById.has(channelId)) {
      return null;
    }

    const token = Symbol(label);
    const reservation: ChannelReservation = {
      channelId,
      label,
      token,
      release: () => {
        if (this.channelReservationsById.get(channelId)?.token === token) {
          this.channelReservationsById.delete(channelId);
          logger.info(`released channel reservation label=${label} ${this.formatVideoAccountLog(channelId)}`);
        }
      },
    };
    this.channelReservationsById.set(channelId, reservation);
    logger.info(`reserved channel label=${label} ${this.formatVideoAccountLog(channelId)}`);
    return reservation;
  }

  async createManualTask(
    mode: TaskRunOptions["mode"],
    channelId = this.browserContexts.getDefaultChannelId(),
    dramaAiRpaId?: string,
  ): Promise<TaskRecord> {
    this.assertChannelAvailable(channelId);

    if (mode === "run" && !dramaAiRpaId) {
      throw new Error("id is required to start a run task.");
    }

    const task: TaskRecord = {
      mode,
      channelId,
      dramaAiRpaId,
      status: "queued",
      createdAt: new Date().toISOString(),
    };

    runWithLogContext(this.createLogContext(task), () => {
      this.enqueueTaskRecord(task, `queued mode=${mode}`);
    });
    void this.runTaskRecord(task).catch(() => undefined);
    return task;
  }

  async createTaskFromClaim(
    channelId: string,
    claimedAccountTask: ClaimedAccountTask,
    playletConfig: Config,
    reservation?: ChannelReservation,
  ): Promise<{ taskRecord: TaskRecord; taskFinished: Promise<void> }> {
    this.assertChannelAvailable(channelId, reservation);

    const taskRecord: TaskRecord = {
      mode: "run",
      channelId,
      accountTaskId: claimedAccountTask.accountTaskId,
      dramaId: claimedAccountTask.dramaId,
      originalTitle: claimedAccountTask.originalTitle,
      videoAccountId: claimedAccountTask.videoAccountId,
      videoAccountName: claimedAccountTask.videoAccountName,
      status: "queued",
      createdAt: new Date().toISOString(),
    };

    runWithLogContext(this.createLogContext(taskRecord), () => {
      this.enqueueTaskRecord(taskRecord, `queued claimed accountTaskId=${claimedAccountTask.accountTaskId}`);
    });
    return { taskRecord, taskFinished: this.runTaskRecord(taskRecord, playletConfig) };
  }

  private assertChannelAvailable(channelId: string, reservation?: ChannelReservation): void {
    if (!this.browserContexts.has(channelId)) {
      throw new Error(`Unknown channelId: ${channelId}`);
    }
    if (this.activeTaskKeyByChannelId.has(channelId)) {
      throw new Error(`Another task is already running for channelId: ${channelId}`);
    }
    const existingReservation = this.channelReservationsById.get(channelId);
    if (existingReservation && existingReservation.token !== reservation?.token) {
      throw new Error(`Channel is reserved by ${existingReservation.label} for channelId: ${channelId}`);
    }
  }

  private enqueueTaskRecord(taskRecord: TaskRecord, logMessage: string): void {
    logger.info(`${logMessage} ${this.formatVideoAccountLog(taskRecord.channelId)}`);
    const taskKey = this.getTaskRecordKey(taskRecord);
    this.taskRecordsByKey.set(taskKey, taskRecord);
    this.activeTaskKeyByChannelId.set(taskRecord.channelId, taskKey);
  }

  private formatVideoAccountLog(channelId: string): string {
    return `videoAccountId=${channelId} name=${this.browserContexts.getVideoAccountName(channelId)}`;
  }

  private createLogContext(taskRecord: TaskRecord): LogContext {
    return {
      videoAccountId: taskRecord.videoAccountId ?? taskRecord.channelId,
      videoAccountName: taskRecord.videoAccountName ?? this.browserContexts.getVideoAccountName(taskRecord.channelId),
      accountTaskId: taskRecord.accountTaskId,
    };
  }

  private formatTaskLog(taskRecord: TaskRecord): string {
    return taskRecord.accountTaskId !== undefined
      ? `accountTaskId=${taskRecord.accountTaskId}`
      : `manual mode=${taskRecord.mode}`;
  }

  private formatAccountTaskKey(accountTaskId: string | number): string {
    return `accountTaskId:${accountTaskId}`;
  }

  private getTaskRecordKey(taskRecord: TaskRecord): string {
    return taskRecord.accountTaskId !== undefined
      ? this.formatAccountTaskKey(taskRecord.accountTaskId)
      : `manual:${taskRecord.mode}:${taskRecord.channelId}`;
  }

  private async runTaskRecord(taskRecord: TaskRecord, playletConfig?: Config): Promise<void> {
    return runWithLogContext(this.createLogContext(taskRecord), async () => {
      taskRecord.status = "running";
      taskRecord.startedAt = new Date().toISOString();
      logger.info(`started ${this.formatTaskLog(taskRecord)} mode=${taskRecord.mode} ${this.formatVideoAccountLog(taskRecord.channelId)}`);
      await this.notifier.notifyTaskStarted({
        mode: taskRecord.mode,
        accountTaskId: taskRecord.accountTaskId,
        dramaId: taskRecord.dramaId,
        originalTitle: taskRecord.originalTitle,
        videoAccountId: taskRecord.videoAccountId ?? taskRecord.channelId,
        videoAccountName: taskRecord.videoAccountName ?? this.browserContexts.getVideoAccountName(taskRecord.channelId),
        dramaAiRpaId: taskRecord.dramaAiRpaId,
      });

      try {
        const browserContext = await this.browserContexts.getOrLaunch(taskRecord.channelId);
        await runPlayletTask({
          playletConfig,
          dramaAiRpaId: taskRecord.dramaAiRpaId,
          mode: taskRecord.mode,
          interactive: false,
          channelId: taskRecord.channelId,
          videoAccountName: this.browserContexts.getVideoAccountName(taskRecord.channelId),
        }, browserContext);
        taskRecord.status = "succeeded";
        logger.info(`succeeded ${this.formatTaskLog(taskRecord)} ${this.formatVideoAccountLog(taskRecord.channelId)}`);
      } catch (error) {
        const errorInfo = classifyError(error, ErrorType.TaskExecution);
        taskRecord.status = "failed";
        taskRecord.error = errorInfo.message;
        taskRecord.errorType = errorInfo.type;
        logger.error(`failed ${this.formatTaskLog(taskRecord)} ${this.formatVideoAccountLog(taskRecord.channelId)}`, {
          errorType: errorInfo.type,
          errorMessage: errorInfo.message,
        });
        if (taskRecord.accountTaskId === undefined) {
          await this.notifier.notifyTaskFailed({
            dramaId: taskRecord.dramaId,
            originalTitle: taskRecord.originalTitle,
            videoAccountId: taskRecord.videoAccountId ?? taskRecord.channelId,
            videoAccountName: taskRecord.videoAccountName ?? this.browserContexts.getVideoAccountName(taskRecord.channelId),
            errorMessage: taskRecord.error,
            errorType: taskRecord.errorType,
          });
        }
        throw error;
      } finally {
        await this.browserContexts.save(taskRecord.channelId).catch(() => undefined);
        taskRecord.finishedAt = new Date().toISOString();
        this.activeTaskKeyByChannelId.delete(taskRecord.channelId);
      }
    });
  }
}
