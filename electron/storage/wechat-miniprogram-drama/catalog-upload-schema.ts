import type Database from "better-sqlite3"

export const selectWechatMiniProgramCatalogUploadColumns = `
  id,
  drama_id AS dramaId,
  wx_drama_id AS wxDramaId,
  drama_name AS dramaName,
  episode_count AS episodeCount,
  baidu_netdisk_url AS baiduNetdiskUrl,
  has_first_four_episodes AS hasFirstFourEpisodes,
  lifecycle_status AS lifecycleStatus,
  audit_status AS auditStatus,
  expected_publish_status AS expectedPublishStatus,
  actual_publish_status AS actualPublishStatus,
  operation_status AS operationStatus,
  state,
  target_episode_count AS targetEpisodeCount,
  uploaded_episode_count AS uploadedEpisodeCount,
  episode_statuses_json AS episodeStatusesJson,
  local_path AS localPath,
  error,
  retry_count AS retryCount,
  created_at AS createdAt,
  updated_at AS updatedAt,
  started_at AS startedAt,
  finished_at AS finishedAt
`

export function migrateWechatMiniProgramCatalogUploadTasks(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS wechat_miniprogram_catalog_upload_tasks (
      id TEXT PRIMARY KEY,
      drama_id INTEGER NOT NULL UNIQUE,
      wx_drama_id INTEGER,
      drama_name TEXT NOT NULL,
      episode_count INTEGER NOT NULL,
      baidu_netdisk_url TEXT,
      has_first_four_episodes INTEGER NOT NULL DEFAULT 0,
      lifecycle_status TEXT,
      audit_status INTEGER,
      expected_publish_status TEXT,
      actual_publish_status TEXT,
      operation_status TEXT,
      state TEXT NOT NULL,
      target_episode_count INTEGER NOT NULL,
      uploaded_episode_count INTEGER NOT NULL DEFAULT 0,
      episode_statuses_json TEXT NOT NULL DEFAULT '[]',
      local_path TEXT,
      error TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_wechat_miniprogram_catalog_upload_state
      ON wechat_miniprogram_catalog_upload_tasks(state, updated_at);
  `)

  const columns = new Set(
    (database.prepare("PRAGMA table_info(wechat_miniprogram_catalog_upload_tasks)").all() as Array<{ name: string }>)
      .map((column) => column.name),
  )
  const additions: Record<string, string> = {
    has_first_four_episodes: "has_first_four_episodes INTEGER NOT NULL DEFAULT 0",
    lifecycle_status: "lifecycle_status TEXT",
    audit_status: "audit_status INTEGER",
    expected_publish_status: "expected_publish_status TEXT",
    actual_publish_status: "actual_publish_status TEXT",
    operation_status: "operation_status TEXT",
  }
  for (const [name, definition] of Object.entries(additions)) {
    if (!columns.has(name)) {
      database.exec(`ALTER TABLE wechat_miniprogram_catalog_upload_tasks ADD COLUMN ${definition}`)
    }
  }
}
