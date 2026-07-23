export interface WechatVideoRuntimeSettings {
  apiBaseUrl: string;
  videoAccountContractSubjects: string;
  localEpisodeVideoRoot: string;
  closeFailedTaskPages: string;
  runDataDir: string;
  logRetentionDays: string;
  workerEmptyClaimDelaySeconds: string;
  workerSlowEmptyClaimThreshold: string;
  workerSlowEmptyClaimDelaySeconds: string;
  videoAccountSyncIntervalSeconds: string;
  auditStatusTaskDelaySeconds: string;
  auditStatusPollingIntervalHours: string;
  idlePageRefreshIntervalSeconds: string;
  idlePageRefreshTimeoutSeconds: string;
  idlePageRefreshJitterSeconds: string;
  basicInfoStepTimeoutSeconds: string;
  remoteFileDownloadTimeoutSeconds: string;
  baiduNetdiskDownloadRetryAttempts: string;
  mergeOwnershipMaterials: string;
  episodeUploadWaitTimeoutSeconds: string;
  episodeUploadFailedRetryAttempts: string;
  feishuBotWebhookUrl: string;
}

export const defaultWechatVideoRuntimeSettings: WechatVideoRuntimeSettings = {
  apiBaseUrl: "http://180.184.76.232:19090",
  videoAccountContractSubjects: "MINGXINGSHUO,MISU,WEITAO,HUANZOU,XIAOSHILIU",
  localEpisodeVideoRoot: "",
  closeFailedTaskPages: "false",
  runDataDir: ".drama-runs/wechat-drama",
  logRetentionDays: "3",
  workerEmptyClaimDelaySeconds: "5",
  workerSlowEmptyClaimThreshold: "30",
  workerSlowEmptyClaimDelaySeconds: "30",
  videoAccountSyncIntervalSeconds: "600",
  auditStatusTaskDelaySeconds: "3",
  auditStatusPollingIntervalHours: "3",
  idlePageRefreshIntervalSeconds: "10800",
  idlePageRefreshTimeoutSeconds: "60",
  idlePageRefreshJitterSeconds: "300",
  basicInfoStepTimeoutSeconds: "600",
  remoteFileDownloadTimeoutSeconds: "120",
  baiduNetdiskDownloadRetryAttempts: "3",
  mergeOwnershipMaterials: "true",
  episodeUploadWaitTimeoutSeconds: "7200",
  episodeUploadFailedRetryAttempts: "3",
  feishuBotWebhookUrl: "",
};

let runtimeSettings = defaultWechatVideoRuntimeSettings;

export function configureWechatVideoRuntimeSettings(settings: Partial<WechatVideoRuntimeSettings> = {}): WechatVideoRuntimeSettings {
  runtimeSettings = {
    ...defaultWechatVideoRuntimeSettings,
    ...settings,
  };
  return runtimeSettings;
}

export function getWechatVideoRuntimeSettings(): WechatVideoRuntimeSettings {
  return runtimeSettings;
}
