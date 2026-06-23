import { ApiClient } from "@drama/axios";
import { getWechatVideoRuntimeSettings } from "./runtime-settings.js";
import { createLogger } from "./logger.js";
import { classifyError, ErrorType } from "./errors.js";

const logger = createLogger("feishu");
const feishuClient = new ApiClient({
  timeout: 10000,
});

export interface TaskNotificationPayload {
  accountTaskId?: number;
  dramaId?: number;
  originalTitle?: string;
  videoAccountId: string;
  videoAccountName: string;
  errorMessage?: string;
  errorType?: ErrorType;
}

export interface TaskStartedNotificationPayload extends TaskNotificationPayload {
  mode: string;
  dramaAiRpaId?: string;
}

export class FeishuNotifier {
  private readonly webhookUrl: string | undefined;

  constructor() {
    this.webhookUrl = getWechatVideoRuntimeSettings().feishuBotWebhookUrl.trim();
  }

  get enabled(): boolean {
    return Boolean(this.webhookUrl);
  }

  async notifyLoginRequired(videoAccountId: string, videoAccountName: string): Promise<void> {
    await this.send(this.formatMessage("视频号需要登录", {
      videoAccountId,
      videoAccountName,
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
    const errorType = payload.errorType ?? (payload.errorMessage
      ? classifyError(new Error(payload.errorMessage)).type
      : ErrorType.Unknown);
    await this.send(this.formatMessage("任务执行失败", { ...payload, errorType }, [
      ["错误类型", errorType],
      ["错误信息", payload.errorMessage],
    ]));
  }

  private formatMessage(
    title: string,
    payload: TaskNotificationPayload,
    extraFields: Array<[string, string | number | undefined]> = [],
  ): string {
    return [
      `【${title}】`,
      `时间：${new Date().toISOString()}`,
      `视频号：${payload.videoAccountName}`,
      `videoAccountId：${payload.videoAccountId}`,
      payload.accountTaskId === undefined ? undefined : `accountTaskId：${payload.accountTaskId}`,
      payload.dramaId === undefined ? undefined : `dramaId：${payload.dramaId}`,
      payload.originalTitle ? `原始剧名：${payload.originalTitle}` : undefined,
      ...extraFields.map(([label, value]) => value === undefined || value === "" ? undefined : `${label}：${value}`),
    ].filter(Boolean).join("\n");
  }

  private async send(text: string): Promise<void> {
    if (!this.webhookUrl) return;

    try {
      await feishuClient.post(this.webhookUrl, {
        msg_type: "text",
        content: { text },
      });
    } catch (error) {
      const errorInfo = classifyError(error);
      logger.warn("send failed", {
        errorType: errorInfo.type,
        errorMessage: errorInfo.message,
      });
    }
  }
}
