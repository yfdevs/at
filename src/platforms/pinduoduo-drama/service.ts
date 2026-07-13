export type PinduoduoDramaLoginState = "login-required" | "logged-in" | "unknown"

export type PinduoduoDramaConfig = {
  accountProfileName: string
  headless: string
  operationDelaySeconds: string
  runDataDir: string
  logRetentionDays: string
  browserWindowWidth: string
}

export type PinduoduoDramaStoragePaths = {
  runDataDir: string
  accountDir: string
  userDataDir: string
  credentialStatePath: string
  logDir: string
  logFilePath: string
}

export type PinduoduoDramaStoragePathKey =
  | keyof PinduoduoDramaStoragePaths
  | "configFilePath"
  | "latestLog"

export type PinduoduoDramaConfigResult = {
  config: PinduoduoDramaConfig
  path: string
  storagePaths: PinduoduoDramaStoragePaths
  restartRequired: boolean
}

export type PinduoduoDramaServiceStatus = {
  platform: "pinduoduo-drama"
  running: boolean
  loginState: PinduoduoDramaLoginState
  activeUrl?: string
  manageUrl: string
  loginExpiredUrl: string
  userDataDir: string
  accountProfileName?: string
  accountDir?: string
  credentialStatePath?: string
  logFilePath?: string
  pid: number | null
}

async function invokePinduoduoDrama<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!window.ipcRenderer) {
    throw new Error("拼多多短剧服务控制仅在 Electron 应用内可用。")
  }

  const result = await window.ipcRenderer.invoke(channel, ...args)
  return result as T
}

export const pinduoduoDramaService = {
  getConfig() {
    return invokePinduoduoDrama<PinduoduoDramaConfigResult>(
      "pinduoduo-drama:config:get"
    )
  },
  saveConfig(config: PinduoduoDramaConfig) {
    return invokePinduoduoDrama<PinduoduoDramaConfigResult>(
      "pinduoduo-drama:config:save",
      config
    )
  },
  selectRunDataDir(currentPath?: string) {
    return invokePinduoduoDrama<string | null>(
      "pinduoduo-drama:config:select-run-data-dir",
      currentPath
    )
  },
  openStoragePath(key: PinduoduoDramaStoragePathKey) {
    return invokePinduoduoDrama<string>("pinduoduo-drama:config:open-storage-path", key)
  },
  status() {
    return invokePinduoduoDrama<PinduoduoDramaServiceStatus>(
      "pinduoduo-drama:service:status"
    )
  },
  start() {
    return invokePinduoduoDrama<PinduoduoDramaServiceStatus>(
      "pinduoduo-drama:service:start"
    )
  },
  stop() {
    return invokePinduoduoDrama<PinduoduoDramaServiceStatus>(
      "pinduoduo-drama:service:stop"
    )
  },
}
