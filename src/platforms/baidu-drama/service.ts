export type BaiduDramaLoginState = "login-required" | "logged-in" | "unknown"

export type BaiduDramaConfig = {
  accountProfileName: string
  localEpisodeVideoRoot: string
  baiduNetdiskDownloadRetryAttempts: string
  episodeUploadWaitTimeoutMinutes: string
  headless: string
  operationDelaySeconds: string
  taskPollIntervalSeconds: string
  runDataDir: string
}

export type BaiduDramaConfigResult = {
  config: BaiduDramaConfig
  path: string
  restartRequired: boolean
}

export type BaiduDramaServiceStatus = {
  platform: "baidu-drama"
  running: boolean
  loginState: BaiduDramaLoginState
  activeUrl?: string
  createUrl: string
  loginUrl: string
  userDataDir: string
  pid: number | null
}

async function invokeBaiduDrama<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!window.ipcRenderer) throw new Error("百度短剧服务控制仅在 Electron 应用内可用。")
  try {
    return await window.ipcRenderer.invoke(channel, ...args) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("BAIDU_DRAMA_LOCAL_VIDEO_ROOT_REQUIRED")) {
      throw new Error("请先选择百度短剧剧集视频根目录。")
    }
    throw new Error(message)
  }
}

export const baiduDramaService = {
  getConfig: () => invokeBaiduDrama<BaiduDramaConfigResult>("baidu-drama:config:get"),
  saveConfig: (config: BaiduDramaConfig) =>
    invokeBaiduDrama<BaiduDramaConfigResult>("baidu-drama:config:save", config),
  selectRunDataDir: (currentPath?: string) =>
    invokeBaiduDrama<string | null>("baidu-drama:config:select-run-data-dir", currentPath),
  selectLocalEpisodeVideoRoot: (currentPath?: string) =>
    invokeBaiduDrama<string | null>("baidu-drama:config:select-local-episode-video-root", currentPath),
  status: () => invokeBaiduDrama<BaiduDramaServiceStatus>("baidu-drama:service:status"),
  start: () => invokeBaiduDrama<BaiduDramaServiceStatus>("baidu-drama:service:start"),
  stop: () => invokeBaiduDrama<BaiduDramaServiceStatus>("baidu-drama:service:stop"),
}
