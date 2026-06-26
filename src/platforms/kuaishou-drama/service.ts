export type KuaishouDramaLoginState = "login-required" | "logged-in" | "unknown"

export type KuaishouDramaConfig = {
  headless: string
  operationDelaySeconds: string
  runDataDir: string
}

export type KuaishouDramaConfigResult = {
  config: KuaishouDramaConfig
  path: string
  restartRequired: boolean
}

export type KuaishouDramaServiceStatus = {
  platform: "kuaishou-drama"
  running: boolean
  loginState: KuaishouDramaLoginState
  activeUrl?: string
  userDataDir: string
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
