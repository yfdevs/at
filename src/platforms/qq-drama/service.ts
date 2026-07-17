export type QqDramaLoginState = "login-required" | "logged-in" | "unknown"

export type QqDramaConfig = {
  accountProfileName: string
  apiBaseUrl: string
  localEpisodeVideoRoot: string
  baiduNetdiskDownloadRetryAttempts: string
  headless: string
  operationDelaySeconds: string
  taskPollIntervalSeconds: string
  runDataDir: string
  logRetentionDays: string
}

export type QqDramaStoragePaths = {
  runDataDir: string
  accountDir: string
  userDataDir: string
  credentialStatePath: string
  assetDownloadDir: string
  logDir: string
  logFilePath: string
}

export type QqDramaStoragePathKey = keyof QqDramaStoragePaths | "configFilePath" | "latestLog"

export type QqDramaConfigResult = {
  config: QqDramaConfig
  path: string
  storagePaths: QqDramaStoragePaths
  restartRequired: boolean
}

export type QqDramaServiceStatus = {
  platform: "qq-drama"
  running: boolean
  loginState: QqDramaLoginState
  activeUrl?: string
  addUrl: string
  loginUrl: string
  userDataDir: string
  accountProfileName?: string
  accountDir?: string
  credentialStatePath?: string
  assetDownloadDir?: string
  logFilePath?: string
  lastTask?: {
    accountTaskId: number
    originalTitle?: string
    status: "running" | "succeeded" | "failed"
    errorMessage?: string
    updatedAt: string
  }
  pid: number | null
}

async function invokeQqDrama<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!window.ipcRenderer) {
    throw new Error("QQ 短剧服务控制仅在 Electron 应用内可用。")
  }

  const result = await window.ipcRenderer.invoke(channel, ...args)
  return result as T
}

export const qqDramaService = {
  getConfig() {
    return invokeQqDrama<QqDramaConfigResult>("qq-drama:config:get")
  },
  saveConfig(config: QqDramaConfig) {
    return invokeQqDrama<QqDramaConfigResult>("qq-drama:config:save", config)
  },
  selectRunDataDir(currentPath?: string) {
    return invokeQqDrama<string | null>("qq-drama:config:select-run-data-dir", currentPath)
  },
  selectLocalEpisodeVideoRoot(currentPath?: string) {
    return invokeQqDrama<string | null>(
      "qq-drama:config:select-local-episode-video-root",
      currentPath
    )
  },
  openStoragePath(key: QqDramaStoragePathKey) {
    return invokeQqDrama<string>("qq-drama:config:open-storage-path", key)
  },
  status() {
    return invokeQqDrama<QqDramaServiceStatus>("qq-drama:service:status")
  },
  start() {
    return invokeQqDrama<QqDramaServiceStatus>("qq-drama:service:start")
  },
  stop() {
    return invokeQqDrama<QqDramaServiceStatus>("qq-drama:service:stop")
  },
}
