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

export interface AuditStatusNotificationPayload extends TaskNotificationPayload {
  auditStatus?: string;
  dramaStatus?: number;
  pendingCount?: number;
  selectedTitle?: string;
  summary?: string;
}

function formatChineseDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
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

  async notifyAuditStatusResult(payload: AuditStatusNotificationPayload): Promise<void> {
    await this.send(this.formatMessage("审核状态查询完成", payload, [
      ["剧名", payload.selectedTitle],
      ["微信状态", payload.dramaStatus],
      ["回写状态", payload.auditStatus],
      ["结果", payload.summary],
    ]));
  }

  async notifyAuditStatusFailed(payload: AuditStatusNotificationPayload): Promise<void> {
    await this.send(this.formatMessage("审核状态查询失败", payload, [
      ["剧名", payload.selectedTitle],
      ["错误信息", payload.errorMessage],
    ]));
  }

  async notifyAuditStatusCycleCompleted(payload: AuditStatusNotificationPayload): Promise<void> {
    await this.send(this.formatMessage("审核状态轮询完成", payload, [
      ["待查询任务数", payload.pendingCount],
      ["结果", payload.summary],
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
      `时间：${formatChineseDateTime(new Date())}`,
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
        const responseBody = await response.text().catch(() => "");
        throw new Error(
          `Feishu webhook failed: ${response.status} ${response.statusText}${responseBody ? ` ${responseBody}` : ""}`,
        );
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
