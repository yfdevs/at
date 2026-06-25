export type MeituanCreationLoginState = "login-required" | "logged-in" | "unknown"

export type MeituanCreationConfig = {
  headless: string
  operationDelaySeconds: string
  runDataDir: string
}

export type MeituanCreationConfigResult = {
  config: MeituanCreationConfig
  path: string
  restartRequired: boolean
}

export type MeituanCreationServiceStatus = {
  platform: "meituan-creation"
  loginUrl: string
  publishVideoUrl: string
  running: boolean
  loginState: MeituanCreationLoginState
  activeUrl?: string
  userDataDir: string
  pid: number | null
}

async function invokeMeituanCreation<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!window.ipcRenderer) {
    throw new Error("美团创作平台服务控制仅在 Electron 应用内可用。")
  }

  const result = await window.ipcRenderer.invoke(channel, ...args)
  return result as T
}

export const meituanCreationService = {
  getConfig() {
    return invokeMeituanCreation<MeituanCreationConfigResult>("meituan-creation:config:get")
  },
  saveConfig(config: MeituanCreationConfig) {
    return invokeMeituanCreation<MeituanCreationConfigResult>(
      "meituan-creation:config:save",
      config
    )
  },
  selectRunDataDir(currentPath?: string) {
    return invokeMeituanCreation<string | null>(
      "meituan-creation:config:select-run-data-dir",
      currentPath
    )
  },
  status() {
    return invokeMeituanCreation<MeituanCreationServiceStatus>(
      "meituan-creation:service:status"
    )
  },
  start() {
    return invokeMeituanCreation<MeituanCreationServiceStatus>(
      "meituan-creation:service:start"
    )
  },
  stop() {
    return invokeMeituanCreation<MeituanCreationServiceStatus>(
      "meituan-creation:service:stop"
    )
  },
}
