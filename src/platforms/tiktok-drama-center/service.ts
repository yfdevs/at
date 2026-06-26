export type TiktokDramaCenterLoginState = "login-required" | "logged-in" | "unknown"

export type TiktokDramaCenterConfig = {
  headless: string
  operationDelaySeconds: string
  runDataDir: string
}

export type TiktokDramaCenterConfigResult = {
  config: TiktokDramaCenterConfig
  path: string
  restartRequired: boolean
}

export type TiktokDramaCenterServiceStatus = {
  platform: "tiktok-drama-center"
  running: boolean
  loginState: TiktokDramaCenterLoginState
  activeUrl?: string
  userDataDir: string
  pid: number | null
}

async function invokeTiktokDramaCenter<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!window.ipcRenderer) {
    throw new Error("TikTok Drama Center 服务控制仅在 Electron 应用内可用。")
  }

  const result = await window.ipcRenderer.invoke(channel, ...args)
  return result as T
}

export const tiktokDramaCenterService = {
  getConfig() {
    return invokeTiktokDramaCenter<TiktokDramaCenterConfigResult>(
      "tiktok-drama-center:config:get"
    )
  },
  saveConfig(config: TiktokDramaCenterConfig) {
    return invokeTiktokDramaCenter<TiktokDramaCenterConfigResult>(
      "tiktok-drama-center:config:save",
      config
    )
  },
  selectRunDataDir(currentPath?: string) {
    return invokeTiktokDramaCenter<string | null>(
      "tiktok-drama-center:config:select-run-data-dir",
      currentPath
    )
  },
  status() {
    return invokeTiktokDramaCenter<TiktokDramaCenterServiceStatus>(
      "tiktok-drama-center:service:status"
    )
  },
  start() {
    return invokeTiktokDramaCenter<TiktokDramaCenterServiceStatus>(
      "tiktok-drama-center:service:start"
    )
  },
  stop() {
    return invokeTiktokDramaCenter<TiktokDramaCenterServiceStatus>(
      "tiktok-drama-center:service:stop"
    )
  },
}
