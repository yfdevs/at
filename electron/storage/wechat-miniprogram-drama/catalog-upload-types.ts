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

export type WechatMiniProgramCatalogUploadTaskRow = Omit<
  WechatMiniProgramCatalogUploadTask,
  "wxDramaId" | "baiduNetdiskUrl" | "episodeStatuses" | "localPath" | "error" | "startedAt" | "finishedAt"
> & {
  wxDramaId: number | null
  baiduNetdiskUrl: string | null
  episodeStatusesJson: string
  localPath: string | null
  error: string | null
  startedAt: string | null
  finishedAt: string | null
}
