export type MeituanCreationLoginState = "login-required" | "logged-in" | "unknown"

export type MeituanCreationConfig = {
  headless: string
  operationDelaySeconds: string
  localEpisodeVideoRoot: string
  runDataDir: string
}

export type MeituanCreationConfigResult = {
  config: MeituanCreationConfig
  path: string
  restartRequired: boolean
}

export type MeituanCreationServiceStatus = {
  platform: "meituan-drama"
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

  try {
    const result = await window.ipcRenderer.invoke(channel, ...args)
    return result as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(readableMeituanCreationError(message))
  }
}

function readableMeituanCreationError(message: string) {
  if (message.includes("MEITUAN_LOCAL_VIDEO_ROOT_REQUIRED")) {
    return "请先在美团创作平台配置中选择剧集视频目录。"
  }

  const rootNotFound = message.match(/MEITUAN_LOCAL_VIDEO_ROOT_NOT_FOUND: root=(.*)$/)
  if (rootNotFound) {
    return `美团剧集视频目录不存在：${rootNotFound[1]}`
  }

  const duplicateEpisodes = message.match(/MEITUAN_LOCAL_VIDEO_DUPLICATE_EPISODES: indexes=([0-9,]*)/)
  if (duplicateEpisodes) {
    return `美团剧集视频存在重复集数：${duplicateEpisodes[1] || "-"}`
  }

  const episodeMismatch = message.match(
    /MEITUAN_LOCAL_VIDEO_EPISODE_MISMATCH: collectionTitle=(.*?) expected=1-(\d+) actual=\[(.*?)\]/
  )
  if (episodeMismatch) {
    const [, title, expectedEnd, actual] = episodeMismatch
    return `美团剧集视频数量不正确：${title} 应包含第 1 集至第 ${expectedEnd} 集，实际匹配到 [${actual || "无"}]。`
  }

  return message
}

export const meituanCreationService = {
  getConfig() {
    return invokeMeituanCreation<MeituanCreationConfigResult>("meituan-drama:config:get")
  },
  saveConfig(config: MeituanCreationConfig) {
    return invokeMeituanCreation<MeituanCreationConfigResult>(
      "meituan-drama:config:save",
      config
    )
  },
  selectRunDataDir(currentPath?: string) {
    return invokeMeituanCreation<string | null>(
      "meituan-drama:config:select-run-data-dir",
      currentPath
    )
  },
  selectLocalEpisodeVideoRoot(currentPath?: string) {
    return invokeMeituanCreation<string | null>(
      "meituan-drama:config:select-local-episode-video-root",
      currentPath
    )
  },
  status() {
    return invokeMeituanCreation<MeituanCreationServiceStatus>(
      "meituan-drama:service:status"
    )
  },
  async start() {
    const { config } = await invokeMeituanCreation<MeituanCreationConfigResult>(
      "meituan-drama:config:get"
    )
    if (!config.localEpisodeVideoRoot.trim()) {
      throw new Error("请先在美团创作平台配置中选择剧集视频目录。")
    }

    return invokeMeituanCreation<MeituanCreationServiceStatus>(
      "meituan-drama:service:start"
    )
  },
  stop() {
    return invokeMeituanCreation<MeituanCreationServiceStatus>(
      "meituan-drama:service:stop"
    )
  },
}
