export type TaobaoDramaLoginState =
  | "login-required"
  | "verification-required"
  | "logged-in"
  | "unknown"

export type TaobaoTaskStatus = "pending" | "downloading" | "uploading" | "succeeded" | "failed"

export type TaobaoDramaConfig = {
  accountProfileName: string
  browserExecutablePath: string
  headless: string
  operationDelaySeconds: string
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

export type TaobaoQueueSummary = Record<TaobaoTaskStatus, number> & { total: number }

export type TaobaoImportedTask = {
  id: string
  originalTitle: string
  baiduPanResourceLink: string
  episodeCount: number
  sourceFileName: string
  sourceSheet: string
  sourceRow: number
  status: TaobaoTaskStatus
  attempts: number
  errorMessage?: string
  dramaTag?: string
  episodeSummaries?: string[]
  synopsisSource?: string
  metadataGeneratedAt?: string
  createdAt: string
  updatedAt: string
}

export type TaobaoDramaServiceStatus = {
  platform: "taobao-drama"
  running: boolean
  loginState: TaobaoDramaLoginState
  activeUrl?: string
  batchPublishUrl: string
  loginUrl: string
  userDataDir: string
  lastTask?: {
    taskId: string
    originalTitle?: string
    status: "running" | "succeeded" | "failed"
    errorMessage?: string
    updatedAt: string
  }
  queue: TaobaoQueueSummary
  pid: number | null
}

export type TaobaoTaskListResult = {
  tasks: TaobaoImportedTask[]
  summary: TaobaoQueueSummary
}

export type TaobaoWorkbookIssue = { sheet: string; row: number; message: string }

export type TaobaoWorkbookImportResult =
  | { canceled: true }
  | {
      canceled: false
      imported: number
      skipped: number
      issues: TaobaoWorkbookIssue[]
      fileName: string
      queue: TaobaoQueueSummary
    }

function readableError(message: string) {
  if (message.includes("TAOBAO_DRAMA_LOCAL_TASK_SOURCE_REQUIRED")) {
    return "淘宝本地任务队列没有正确初始化。"
  }
  if (message.includes("TAOBAO_DRAMA_IMPORTED_TASK_NOT_FOUND")) {
    return "这条淘宝任务已不存在，请刷新列表。"
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
  testBrowserPath: (executablePath: string) =>
    invoke<{ ok: boolean; message: string }>(
      "taobao-drama:config:test-browser-path",
      executablePath,
    ),
  status: () => invoke<TaobaoDramaServiceStatus>("taobao-drama:service:status"),
  start: () => invoke<TaobaoDramaServiceStatus>("taobao-drama:service:start"),
  stop: () => invoke<TaobaoDramaServiceStatus>("taobao-drama:service:stop"),
  importWorkbook: () => invoke<TaobaoWorkbookImportResult>("taobao-drama:tasks:import"),
  listTasks: () => invoke<TaobaoTaskListResult>("taobao-drama:tasks:list"),
  openTaskDataWindow: () => invoke<void>("taobao-drama:tasks:window:open"),
  retryTask: (taskId: string) =>
    invoke<{ retried: boolean; summary: TaobaoQueueSummary }>("taobao-drama:tasks:retry", taskId),
}
