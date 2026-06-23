import type { IpcRendererEvent } from "electron"

export type WechatVideoAccountStatus = {
  videoAccountId: string
  videoAccountName: string
  contractSubject?: string
  contractSubjectLabel?: string
  launched: boolean
  loginState: "not-launched" | "login-required" | "logged-in" | "unknown"
  pageCount: number
  activeUrl?: string
  userDataDir: string
}

export type WechatVideoServiceStatus = {
  running: boolean
  pid: number | null
  contractSubjects: Array<{ label: string; value: string }>
  videoAccounts: WechatVideoAccountStatus[]
  memory: {
    processRssBytes: number
    systemUsedBytes: number
    systemTotalBytes: number
    systemUsedPercent: number
  }
}

export type WechatVideoConfig = {
  apiBaseUrl: string
  videoAccountContractSubjects: string
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

  const result = await window.ipcRenderer.invoke(channel, ...args)
  return result as T
}

function onWechatVideo<T>(channel: string, listener: (payload: T) => void) {
  if (!window.ipcRenderer) {
    throw new Error("微信视频号服务控制仅在 Electron 应用内可用。")
  }

  const ipcListener = (_event: IpcRendererEvent, payload: T) => listener(payload)
  window.ipcRenderer.on(channel, ipcListener)

  return () => {
    window.ipcRenderer.off(channel, ipcListener)
  }
}

export const wechatVideoService = {
  getConfig() {
    return invokeWechatVideo<WechatVideoConfigResult>("wechat-video:config:get")
  },
  saveConfig(config: WechatVideoConfig) {
    return invokeWechatVideo<WechatVideoConfigResult>("wechat-video:config:save", config)
  },
  onConfigChanged(listener: (result: WechatVideoConfigResult) => void) {
    return onWechatVideo<WechatVideoConfigResult>("wechat-video:config:changed", listener)
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
  focusVideoAccount(videoAccountId: string) {
    return invokeWechatVideo<WechatVideoServiceStatus>(
      "wechat-video:service:video-account:focus",
      videoAccountId
    )
  },
}
