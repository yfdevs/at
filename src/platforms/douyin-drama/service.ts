export type DouyinDramaLoginState = "login-required" | "logged-in" | "unknown"

export type DouyinDramaConfig = {
  accountProfileName: string
  apiBaseUrl: string
  useMockTask: string
  localEpisodeVideoRoot: string
  baiduNetdiskDownloadRetryAttempts: string
  episodeUploadWaitTimeoutMinutes: string
  headless: string
  operationDelaySeconds: string
  taskPollIntervalSeconds: string
  runDataDir: string
  logRetentionDays: string
}

export type DouyinDramaConfigResult = {
  config: DouyinDramaConfig
  path: string
  restartRequired: boolean
}

export type DouyinDramaServiceStatus = {
  platform: "douyin-drama"
  running: boolean
  loginState: DouyinDramaLoginState
  activeUrl?: string
  createUrl: string
  loginUrl: string
  userDataDir: string
  pid: number | null
}

async function invokeDouyinDrama<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!window.ipcRenderer) {
    throw new Error("抖音短剧服务控制仅在 Electron 应用内可用。")
  }
  try {
    return await window.ipcRenderer.invoke(channel, ...args) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const readableMessage = message.includes("DOUYIN_DRAMA_LOCAL_VIDEO_ROOT_REQUIRED")
      ? "请先选择抖音短剧剧集视频根目录。"
      : message
    const readableError = new Error(readableMessage) as Error & { cause?: unknown }
    readableError.cause = error
    throw readableError
  }
}

export const douyinDramaService = {
  getConfig: () => invokeDouyinDrama<DouyinDramaConfigResult>("douyin-drama:config:get"),
  saveConfig: (config: DouyinDramaConfig) =>
    invokeDouyinDrama<DouyinDramaConfigResult>("douyin-drama:config:save", config),
  selectRunDataDir: (currentPath?: string) =>
    invokeDouyinDrama<string | null>("douyin-drama:config:select-run-data-dir", currentPath),
  selectLocalEpisodeVideoRoot: (currentPath?: string) =>
    invokeDouyinDrama<string | null>(
      "douyin-drama:config:select-local-episode-video-root",
      currentPath,
    ),
  status: () => invokeDouyinDrama<DouyinDramaServiceStatus>("douyin-drama:service:status"),
  start: () => invokeDouyinDrama<DouyinDramaServiceStatus>("douyin-drama:service:start"),
  stop: () => invokeDouyinDrama<DouyinDramaServiceStatus>("douyin-drama:service:stop"),
}
