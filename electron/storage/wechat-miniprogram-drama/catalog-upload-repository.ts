import type Database from "better-sqlite3"
import { randomUUID } from "node:crypto"

import { openAutomationDatabase } from "../database"
import {
  migrateWechatMiniProgramCatalogUploadTasks,
  selectWechatMiniProgramCatalogUploadColumns,
} from "./catalog-upload-schema"
import type {
  WechatMiniProgramCatalogEpisodeStatus,
  WechatMiniProgramCatalogUploadTask,
  WechatMiniProgramCatalogUploadTaskRow,
} from "./catalog-upload-types"

function parseEpisodeStatuses(value: string): WechatMiniProgramCatalogEpisodeStatus[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed as WechatMiniProgramCatalogEpisodeStatus[] : []
  } catch {
    return []
  }
}

function readTask(row: WechatMiniProgramCatalogUploadTaskRow): WechatMiniProgramCatalogUploadTask {
  return {
    id: row.id,
    dramaId: row.dramaId,
    wxDramaId: row.wxDramaId ?? undefined,
    dramaName: row.dramaName,
    episodeCount: row.episodeCount,
    baiduNetdiskUrl: row.baiduNetdiskUrl ?? undefined,
    hasFirstFourEpisodes: Boolean(row.hasFirstFourEpisodes),
    lifecycleStatus: row.lifecycleStatus ?? undefined,
    auditStatus: row.auditStatus ?? undefined,
    expectedPublishStatus: row.expectedPublishStatus ?? undefined,
    actualPublishStatus: row.actualPublishStatus ?? undefined,
    operationStatus: row.operationStatus ?? undefined,
    state: row.state,
    targetEpisodeCount: row.targetEpisodeCount,
    uploadedEpisodeCount: row.uploadedEpisodeCount,
    episodeStatuses: parseEpisodeStatuses(row.episodeStatusesJson),
    localPath: row.localPath ?? undefined,
    error: row.error ?? undefined,
    retryCount: row.retryCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt ?? undefined,
    finishedAt: row.finishedAt ?? undefined,
  }
}

function writeParams(task: WechatMiniProgramCatalogUploadTask) {
  return {
    ...task,
    wxDramaId: task.wxDramaId ?? null,
    baiduNetdiskUrl: task.baiduNetdiskUrl ?? null,
    hasFirstFourEpisodes: task.hasFirstFourEpisodes ? 1 : 0,
    lifecycleStatus: task.lifecycleStatus ?? null,
    auditStatus: task.auditStatus ?? null,
    expectedPublishStatus: task.expectedPublishStatus ?? null,
    actualPublishStatus: task.actualPublishStatus ?? null,
    operationStatus: task.operationStatus ?? null,
    episodeStatusesJson: JSON.stringify(task.episodeStatuses),
    localPath: task.localPath ?? null,
    error: task.error ?? null,
    startedAt: task.startedAt ?? null,
    finishedAt: task.finishedAt ?? null,
  }
}

export class WechatMiniProgramCatalogUploadTaskRepository {
  private readonly database: Database.Database
  readonly databasePath: string

  constructor() {
    const opened = openAutomationDatabase()
    this.database = opened.database
    this.databasePath = opened.databasePath
    migrateWechatMiniProgramCatalogUploadTasks(this.database)
  }

  list(): WechatMiniProgramCatalogUploadTask[] {
    const rows = this.database.prepare(`
      SELECT ${selectWechatMiniProgramCatalogUploadColumns}
      FROM wechat_miniprogram_catalog_upload_tasks
      ORDER BY drama_id DESC
    `).all() as WechatMiniProgramCatalogUploadTaskRow[]
    return rows.map(readTask)
  }

  findById(id: string): WechatMiniProgramCatalogUploadTask | null {
    const row = this.database.prepare(`
      SELECT ${selectWechatMiniProgramCatalogUploadColumns}
      FROM wechat_miniprogram_catalog_upload_tasks WHERE id=@id
    `).get({ id }) as WechatMiniProgramCatalogUploadTaskRow | undefined
    return row ? readTask(row) : null
  }

  findByDramaId(dramaId: number): WechatMiniProgramCatalogUploadTask | null {
    const row = this.database.prepare(`
      SELECT ${selectWechatMiniProgramCatalogUploadColumns}
      FROM wechat_miniprogram_catalog_upload_tasks WHERE drama_id=@dramaId
    `).get({ dramaId }) as WechatMiniProgramCatalogUploadTaskRow | undefined
    return row ? readTask(row) : null
  }

  upsertDiscovered(input: {
    dramaId: number
    wxDramaId?: number
    dramaName: string
    episodeCount: number
    baiduNetdiskUrl?: string
    hasFirstFourEpisodes: boolean
    lifecycleStatus?: string
    auditStatus?: number
    expectedPublishStatus?: string
    actualPublishStatus?: string
    operationStatus?: string
    targetEpisodeCount: number
  }): WechatMiniProgramCatalogUploadTask {
    const current = this.findByDramaId(input.dramaId)
    if (current) {
      const sourceAvailable = Boolean(input.baiduNetdiskUrl?.trim())
      return this.update(current.id, {
        wxDramaId: input.wxDramaId,
        dramaName: input.dramaName,
        episodeCount: input.episodeCount,
        baiduNetdiskUrl: input.baiduNetdiskUrl,
        hasFirstFourEpisodes: input.hasFirstFourEpisodes,
        lifecycleStatus: input.lifecycleStatus,
        auditStatus: input.auditStatus,
        expectedPublishStatus: input.expectedPublishStatus,
        actualPublishStatus: input.actualPublishStatus,
        operationStatus: input.operationStatus,
        targetEpisodeCount: input.targetEpisodeCount,
        state: input.hasFirstFourEpisodes
          ? "completed"
          : current.state === "missing-source" && sourceAvailable
            ? "discovered"
            : current.state,
        uploadedEpisodeCount: input.hasFirstFourEpisodes
          ? input.targetEpisodeCount
          : current.uploadedEpisodeCount,
        error: input.hasFirstFourEpisodes || (current.state === "missing-source" && sourceAvailable)
          ? undefined
          : current.error,
      })
    }
    const now = new Date().toISOString()
    const task: WechatMiniProgramCatalogUploadTask = {
      id: randomUUID(),
      ...input,
      state: input.hasFirstFourEpisodes
        ? "completed"
        : input.baiduNetdiskUrl?.trim() ? "discovered" : "missing-source",
      uploadedEpisodeCount: input.hasFirstFourEpisodes ? input.targetEpisodeCount : 0,
      episodeStatuses: [],
      retryCount: 0,
      error: input.hasFirstFourEpisodes || input.baiduNetdiskUrl?.trim()
        ? undefined
        : "剧列表未提供百度网盘链接。",
      createdAt: now,
      updatedAt: now,
    }
    this.insertOrReplace(task)
    return task
  }

  upsertDiscoveredBatch(inputs: Parameters<this["upsertDiscovered"]>[0][]) {
    const transaction = this.database.transaction(() => inputs.map((input) => this.upsertDiscovered(input)))
    return transaction()
  }

  update(
    id: string,
    patch: Partial<Omit<WechatMiniProgramCatalogUploadTask, "id" | "createdAt">>,
  ): WechatMiniProgramCatalogUploadTask {
    const current = this.findById(id)
    if (!current) throw new Error(`前四集上传记录不存在：${id}`)
    const task = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    }
    this.insertOrReplace(task)
    return task
  }

  retry(id: string): WechatMiniProgramCatalogUploadTask {
    const current = this.findById(id)
    if (!current) throw new Error(`前四集上传记录不存在：${id}`)
    if (!current.baiduNetdiskUrl?.trim()) throw new Error("当前剧目没有百度网盘链接，无法重试。")
    return this.update(id, {
      state: "discovered",
      error: undefined,
      retryCount: current.retryCount + 1,
      finishedAt: undefined,
    })
  }

  recoverInterrupted(): void {
    const now = new Date().toISOString()
    this.database.prepare(`
      UPDATE wechat_miniprogram_catalog_upload_tasks
      SET state='interrupted', error='应用上次退出时任务尚未完成，请重新开始队列。',
          updated_at=@now, finished_at=@now
      WHERE state IN ('downloading', 'uploading')
    `).run({ now })
  }

  private insertOrReplace(task: WechatMiniProgramCatalogUploadTask): void {
    this.database.prepare(`
      INSERT INTO wechat_miniprogram_catalog_upload_tasks (
        id, drama_id, wx_drama_id, drama_name, episode_count, baidu_netdisk_url,
        has_first_four_episodes, lifecycle_status, audit_status,
        expected_publish_status, actual_publish_status, operation_status,
        state, target_episode_count, uploaded_episode_count, episode_statuses_json,
        local_path, error, retry_count, created_at, updated_at, started_at, finished_at
      ) VALUES (
        @id, @dramaId, @wxDramaId, @dramaName, @episodeCount, @baiduNetdiskUrl,
        @hasFirstFourEpisodes, @lifecycleStatus, @auditStatus,
        @expectedPublishStatus, @actualPublishStatus, @operationStatus,
        @state, @targetEpisodeCount, @uploadedEpisodeCount, @episodeStatusesJson,
        @localPath, @error, @retryCount, @createdAt, @updatedAt, @startedAt, @finishedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        wx_drama_id=excluded.wx_drama_id, drama_name=excluded.drama_name,
        episode_count=excluded.episode_count, baidu_netdisk_url=excluded.baidu_netdisk_url,
        has_first_four_episodes=excluded.has_first_four_episodes,
        lifecycle_status=excluded.lifecycle_status, audit_status=excluded.audit_status,
        expected_publish_status=excluded.expected_publish_status,
        actual_publish_status=excluded.actual_publish_status,
        operation_status=excluded.operation_status,
        state=excluded.state, target_episode_count=excluded.target_episode_count,
        uploaded_episode_count=excluded.uploaded_episode_count,
        episode_statuses_json=excluded.episode_statuses_json, local_path=excluded.local_path,
        error=excluded.error, retry_count=excluded.retry_count, updated_at=excluded.updated_at,
        started_at=excluded.started_at, finished_at=excluded.finished_at
    `).run(writeParams(task))
  }
}
