export type KuaishouDramaLoginState = "login-required" | "logged-in" | "unknown"

export type KuaishouDramaConfig = {
  accountProfileName: string
  headless: string
  operationDelaySeconds: string
  runDataDir: string
  logRetentionDays: string
  mockTaskEnabled: string
}

export type KuaishouDramaStoragePaths = {
  runDataDir: string
  accountDir: string
  userDataDir: string
  credentialStatePath: string
  assetDownloadDir: string
  logDir: string
  logFilePath: string
}

export type KuaishouDramaStoragePathKey = keyof KuaishouDramaStoragePaths | "configFilePath" | "latestLog"

export type KuaishouDramaConfigResult = {
  config: KuaishouDramaConfig
  path: string
  storagePaths: KuaishouDramaStoragePaths
  restartRequired: boolean
}

export type KuaishouDramaServiceStatus = {
  platform: "kuaishou-drama"
  running: boolean
  loginState: KuaishouDramaLoginState
  activeUrl?: string
  userDataDir: string
  accountProfileName?: string
  accountDir?: string
  credentialStatePath?: string
  assetDownloadDir?: string
  logFilePath?: string
  pid: number | null
}

async function invokeKuaishouDrama<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!window.ipcRenderer) {
    throw new Error("快手短剧服务控制仅在 Electron 应用内可用。")
  }

  const result = await window.ipcRenderer.invoke(channel, ...args)
  return result as T
}

export const kuaishouDramaService = {
  getConfig() {
    return invokeKuaishouDrama<KuaishouDramaConfigResult>("kuaishou-drama:config:get")
  },
  saveConfig(config: KuaishouDramaConfig) {
    return invokeKuaishouDrama<KuaishouDramaConfigResult>(
      "kuaishou-drama:config:save",
      config
    )
  },
  selectRunDataDir(currentPath?: string) {
    return invokeKuaishouDrama<string | null>(
      "kuaishou-drama:config:select-run-data-dir",
      currentPath
    )
  },
  openStoragePath(key: KuaishouDramaStoragePathKey) {
    return invokeKuaishouDrama<string>("kuaishou-drama:config:open-storage-path", key)
  },
  status() {
    return invokeKuaishouDrama<KuaishouDramaServiceStatus>("kuaishou-drama:service:status")
  },
  start() {
    return invokeKuaishouDrama<KuaishouDramaServiceStatus>("kuaishou-drama:service:start")
  },
  stop() {
    return invokeKuaishouDrama<KuaishouDramaServiceStatus>("kuaishou-drama:service:stop")
  },
}
