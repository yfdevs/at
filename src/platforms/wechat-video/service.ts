export type WechatVideoServiceStatus = {
  running: boolean
  pid: number | null
}

export type WechatVideoConfig = {
  apiBaseUrl: string
  localEpisodeVideoRoot: string
  closeFailedTaskPages: string
  runDataDir: string
  logRetentionDays: string
  workerEmptyClaimDelaySeconds: string
  workerSlowEmptyClaimThreshold: string
  workerSlowEmptyClaimDelaySeconds: string
  videoAccountSyncIntervalSeconds: string
  idlePageRefreshIntervalSeconds: string
  idlePageRefreshTimeoutSeconds: string
  idlePageRefreshJitterSeconds: string
  basicInfoStepTimeoutSeconds: string
  remoteFileDownloadTimeoutSeconds: string
  episodeUploadWaitTimeoutSeconds: string
  episodeUploadFailedRetryAttempts: string
  feishuBotWebhookUrl: string
}

export type WechatVideoConfigResult = {
  config: WechatVideoConfig
  path: string
  restartRequired: boolean
}

async function invokeWechatVideo<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!window.ipcRenderer) {
    throw new Error("微信视频号服务控制仅在 Electron 应用内可用。")
  }

  return window.ipcRenderer.invoke<T>(channel, ...args)
}

export const wechatVideoService = {
  getConfig() {
    return invokeWechatVideo<WechatVideoConfigResult>("wechat-video:config:get")
  },
  saveConfig(config: WechatVideoConfig) {
    return invokeWechatVideo<WechatVideoConfigResult>("wechat-video:config:save", config)
  },
  selectLocalEpisodeVideoRoot(currentPath?: string) {
    return invokeWechatVideo<string | null>(
      "wechat-video:config:select-local-episode-video-root",
      currentPath
    )
  },
  selectRunDataDir(currentPath?: string) {
    return invokeWechatVideo<string | null>(
      "wechat-video:config:select-run-data-dir",
      currentPath
    )
  },
  status() {
    return invokeWechatVideo<WechatVideoServiceStatus>("wechat-video:service:status")
  },
  start() {
    return invokeWechatVideo<WechatVideoServiceStatus>("wechat-video:service:start")
  },
  stop() {
    return invokeWechatVideo<WechatVideoServiceStatus>("wechat-video:service:stop")
  },
}
