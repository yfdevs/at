import type { IpcRendererEvent } from "electron"

export type WechatMiniProgramCatalogUploadState =
  | "discovered"
  | "missing-source"
  | "downloading"
  | "uploading"
  | "completed"
  | "failed"
  | "interrupted"

export type WechatMiniProgramCatalogEpisodeStatus = {
  episodeNo: number
  state: "pending" | "uploaded" | "existing" | "failed"
  materialId?: string
  fileName?: string
  error?: string
}

export type WechatMiniProgramCatalogUploadTask = {
  id: string
  dramaId: number
  wxDramaId?: number
  dramaName: string
  episodeCount: number
  baiduNetdiskUrl?: string
  state: WechatMiniProgramCatalogUploadState
  targetEpisodeCount: number
  uploadedEpisodeCount: number
  episodeStatuses: WechatMiniProgramCatalogEpisodeStatus[]
  localPath?: string
  error?: string
  retryCount: number
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
}

export type WechatMiniProgramCatalogUploadWorkspace = {
  queue: {
    running: boolean
    activeTaskId?: string
    currentPage: number
    totalPages?: number
    error?: string
  }
  tasks: WechatMiniProgramCatalogUploadTask[]
  databasePath: string
}

function ipc() {
  if (!window.ipcRenderer) throw new Error("前四集入库仅在 Electron 应用内可用。")
  return window.ipcRenderer
}

function invoke(channel: string, ...args: unknown[]) {
  return ipc().invoke(channel, ...args) as Promise<WechatMiniProgramCatalogUploadWorkspace>
}

export const wechatMiniProgramCatalogUploadService = {
  openWindow: () => invoke("wechat-miniprogram-drama:catalog-upload:window:open"),
  workspace: () => invoke("wechat-miniprogram-drama:catalog-upload:workspace:get"),
  startQueue: () => invoke("wechat-miniprogram-drama:catalog-upload:queue:start"),
  pauseQueue: () => invoke("wechat-miniprogram-drama:catalog-upload:queue:pause"),
  cancelActiveTask: () => invoke("wechat-miniprogram-drama:catalog-upload:task:cancel-active"),
  retryTask: (id: string) => invoke("wechat-miniprogram-drama:catalog-upload:task:retry", id),
  onWorkspaceChanged(listener: (workspace: WechatMiniProgramCatalogUploadWorkspace) => void) {
    if (!window.ipcRenderer) return () => undefined
    const ipcListener = (_event: IpcRendererEvent, workspace: WechatMiniProgramCatalogUploadWorkspace) => listener(workspace)
    window.ipcRenderer.on("wechat-miniprogram-drama:catalog-upload:workspace:changed", ipcListener)
    return () => window.ipcRenderer?.off(
      "wechat-miniprogram-drama:catalog-upload:workspace:changed",
      ipcListener,
    )
  },
}
