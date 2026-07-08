type NotifierLogger = {
  warn: (message: string, fields?: any) => void;
};

export interface FeishuNotifierOptions {
  channelIdLabel?: string;
  channelLabel?: string;
  logger?: NotifierLogger;
  timeoutMs?: number;
  webhookUrl?: string;
}

export interface TaskNotificationPayload {
  accountTaskId?: number;
  channelId?: string;
  channelName?: string;
  dramaId?: number;
  errorMessage?: string;
  errorType?: string;
  originalTitle?: string;
  videoAccountId?: string;
  videoAccountName?: string;
}

export interface TaskStartedNotificationPayload extends TaskNotificationPayload {
  dramaAiRpaId?: string;
  mode: string;
}

export class FeishuNotifier {
  private readonly channelIdLabel: string;
  private readonly channelLabel: string;
  private readonly logger?: NotifierLogger;
  private readonly timeoutMs: number;
  private readonly webhookUrl: string | undefined;

  constructor(options: FeishuNotifierOptions = {}) {
    this.channelIdLabel = options.channelIdLabel ?? "channelId";
    this.channelLabel = options.channelLabel ?? "账号";
    this.logger = options.logger;
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.webhookUrl = options.webhookUrl?.trim() || undefined;
  }

  get enabled(): boolean {
    return Boolean(this.webhookUrl);
  }

  async notifyLoginRequired(channelId: string, channelName: string): Promise<void> {
    await this.send(this.formatMessage("需要登录", {
      channelId,
      channelName,
    }));
  }

  async notifyTaskStarted(payload: TaskStartedNotificationPayload): Promise<void> {
    await this.send(this.formatMessage("任务开始执行", payload, [
      ["mode", payload.mode],
      ["dramaAiRpaId", payload.dramaAiRpaId],
    ]));
  }

  async notifyTaskSucceeded(payload: TaskNotificationPayload): Promise<void> {
    await this.send(this.formatMessage("任务执行成功", payload));
  }

  async notifyTaskFailed(payload: TaskNotificationPayload): Promise<void> {
    await this.send(this.formatMessage("任务执行失败", payload, [
      ["错误类型", payload.errorType ?? "Unknown"],
      ["错误信息", payload.errorMessage],
    ]));
  }

  private formatMessage(
    title: string,
    payload: TaskNotificationPayload,
    extraFields: Array<[string, string | number | undefined]> = [],
  ): string {
    const channelId = payload.channelId ?? payload.videoAccountId;
    const channelName = payload.channelName ?? payload.videoAccountName ?? channelId;

    return [
      `【${this.channelLabel}${title}】`,
      `时间：${new Date().toISOString()}`,
      channelName ? `${this.channelLabel}：${channelName}` : undefined,
      channelId ? `${this.channelIdLabel}：${channelId}` : undefined,
      payload.accountTaskId === undefined ? undefined : `accountTaskId：${payload.accountTaskId}`,
      payload.dramaId === undefined ? undefined : `dramaId：${payload.dramaId}`,
      payload.originalTitle ? `原始剧名：${payload.originalTitle}` : undefined,
      ...extraFields.map(([label, value]) => value === undefined || value === "" ? undefined : `${label}：${value}`),
    ].filter(Boolean).join("\n");
  }

  private async send(text: string): Promise<void> {
    if (!this.webhookUrl) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          msg_type: "text",
          content: { text },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Feishu webhook failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      this.logger?.warn("send failed", {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
