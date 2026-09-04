export type GlobalAppConfig = {
  aiApiKey: string
  aiBaseURL: string
  aiModel: string
  aiImageModel: string
  aiPosterFallbackEnabled: boolean
  localAiEnabled: boolean
  localAiModelPath: string
  localAiMmprojPath: string
  localAiContextSize: string
  localAiThreads: string
  baiduNetdiskDownloadTimeoutMinutes: string
  runDataRoot: string
  localMaterialRoot: string
}

export type GlobalAppConfigResult = {
  config: GlobalAppConfig
  path: string
  restartRequired: boolean
}

export type AiConfigTestResult = {
  latencyMs: number
  model: string
  responseText: string
}

async function invokeGlobalAppConfig<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!window.ipcRenderer) throw new Error("全局配置仅在 Electron 应用内可用。")

  try {
    return await window.ipcRenderer.invoke(channel, ...args) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("APP_CONFIG_ENCRYPTION_UNAVAILABLE")) {
      if (error instanceof Error) {
        error.message = "当前系统无法安全加密 API Key，请确认系统凭据服务可用后重试。"
      }
      throw error
    }
    if (message.includes("APP_CONFIG_API_KEY_DECRYPT_FAILED")) {
      if (error instanceof Error) {
        error.message = "已保存的 API Key 无法解密，请重新填写并保存。"
      }
      throw error
    }
    if (message.includes("AI_BASE_URL_INVALID")) {
      if (error instanceof Error) {
        error.message = "API Base URL 必须是有效的 HTTP 或 HTTPS 地址。"
      }
      throw error
    }
    if (message.includes("DRAMA_AI_API_KEY_REQUIRED")) {
      if (error instanceof Error) error.message = "请填写 API Key 后再测试。"
      throw error
    }
    if (message.includes("DRAMA_AI_MODEL_REQUIRED")) {
      if (error instanceof Error) error.message = "请填写模型 ID 后再测试。"
      throw error
    }
    if (message.includes("LOCAL_AI_MODEL_PATH_REQUIRED")) {
      if (error instanceof Error) error.message = "请选择本地 GGUF 模型后再测试。"
      throw error
    }
    if (message.includes("LOCAL_AI_CONTEXT_SIZE_INVALID")) {
      if (error instanceof Error) error.message = "上下文长度必须是正整数。"
      throw error
    }
    if (message.includes("LOCAL_AI_THREADS_INVALID")) {
      if (error instanceof Error) error.message = "CPU 线程数必须是正整数或留空。"
      throw error
    }
    if (message.includes("LLAMA_SERVER_BUNDLED_RUNTIME_MISSING")) {
      if (error instanceof Error) error.message = "应用内置的本地 AI Runtime 缺失，请重新安装应用。"
      throw error
    }
    throw error
  }
}

export const globalAppConfigService = {
  getConfig: () => invokeGlobalAppConfig<GlobalAppConfigResult>("app:config:get"),
  saveConfig: (config: GlobalAppConfig) =>
    invokeGlobalAppConfig<GlobalAppConfigResult>("app:config:save", config),
  testConfig: (config: GlobalAppConfig) =>
    invokeGlobalAppConfig<AiConfigTestResult>("app:config:test", config),
  openArkApiKeyPage: () =>
    invokeGlobalAppConfig<void>("app:config:open-ark-api-key-page"),
  selectDirectory: (
    key: "runDataRoot" | "localMaterialRoot",
    currentPath?: string,
  ) => invokeGlobalAppConfig<string | null>(
    "app:config:select-directory",
    key,
    currentPath,
  ),
  selectLocalAiFile: (
    key: "localAiModelPath" | "localAiMmprojPath",
    currentPath?: string,
  ) => invokeGlobalAppConfig<string | null>(
    "app:config:select-local-ai-file",
    key,
    currentPath,
  ),
}
