export type WechatMiniProgramDirectUploadTaskState =
  | "queued"
  | "inspecting"
  | "downloading"
  | "waiting-login"
  | "uploading"
  | "completed"
  | "failed"
  | "interrupted"

export type WechatMiniProgramDirectUploadTask = {
  id: string
  queueOrder: number
  dramaName: string
  shareText: string
  shareKey: string
  state: WechatMiniProgramDirectUploadTaskState
  inferredEpisodeCount?: number
  episodeIndexes?: number[]
  localPath?: string
  uploadCompletedCount: number
  uploadTotalCount: number
  uploadAccountLabel?: string
  error?: string
  retryCount: number
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
}

export type WechatMiniProgramDirectUploadTaskRow = Omit<
  WechatMiniProgramDirectUploadTask,
  | "inferredEpisodeCount"
  | "episodeIndexes"
  | "localPath"
  | "uploadAccountLabel"
  | "error"
  | "startedAt"
  | "finishedAt"
> & {
  inferredEpisodeCount: number | null
  episodeIndexesJson: string | null
  localPath: string | null
  uploadAccountLabel: string | null
  error: string | null
  startedAt: string | null
  finishedAt: string | null
}
