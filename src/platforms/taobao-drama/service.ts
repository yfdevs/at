export type TaobaoDramaLoginState =
  | "login-required"
  | "verification-required"
  | "logged-in"
  | "unknown"

export type TaobaoDramaConfig = {
  apiBaseUrl: string
  headless: string
  operationDelaySeconds: string
  taskPollIntervalSeconds: string
  baiduNetdiskDownloadRetryAttempts: string
  episodeUploadWaitTimeoutMinutes: string
  closeFailedTaskPages: string
  runDataDir: string
  logRetentionDays: string
}

export type TaobaoDramaConfigResult = {
  config: TaobaoDramaConfig
  path: string
  restartRequired: boolean
}

export type TaobaoDramaServiceStatus = {
  platform: "taobao-drama"
  running: boolean
  collectionCreateUrl: string
  batchPublishUrl: string
  loginUrl: string
  accounts: Array<{
    accountId: string
    accountName: string
    loginAccount?: string | null
    launched: boolean
    loginState: TaobaoDramaLoginState
    activeUrl?: string
    userDataDir: string
    lastTask?: {
      accountTaskId: number
      originalTitle?: string
      status: "running" | "succeeded" | "failed"
      errorMessage?: string
      updatedAt: string
    }
  }>
  pid: number | null
}

function readableError(message: string) {
  if (message.includes("TAOBAO_DRAMA_ENABLED_ACCOUNT_NOT_FOUND")) {
    return "没有获取到已启用的淘宝账号，请先在后台添加并启用淘宝账号。"
  }
  if (message.includes("TAOBAO_DRAMA_ACCOUNT_CONFIG_REQUEST_FAILED")) {
    return `淘宝账号列表获取失败：${message}`
  }
  if (message.includes("TAOBAO_DRAMA_API_BASE_URL_REQUIRED")) {
    return "请先配置淘宝 RPA 后台接口地址。"
  }
  return message
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!window.ipcRenderer) throw new Error("淘宝短剧服务仅在 Electron 应用内可用。")
  try {
    return await window.ipcRenderer.invoke(channel, ...args) as T
  } catch (error) {
    throw new Error(readableError(error instanceof Error ? error.message : String(error)))
  }
}

export const taobaoDramaService = {
  getConfig: () => invoke<TaobaoDramaConfigResult>("taobao-drama:config:get"),
  saveConfig: (config: TaobaoDramaConfig) =>
    invoke<TaobaoDramaConfigResult>("taobao-drama:config:save", config),
  status: () => invoke<TaobaoDramaServiceStatus>("taobao-drama:service:status"),
  start: () => invoke<TaobaoDramaServiceStatus>("taobao-drama:service:start"),
  stop: () => invoke<TaobaoDramaServiceStatus>("taobao-drama:service:stop"),
}
