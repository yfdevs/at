import type Database from "better-sqlite3"

export const selectWechatMiniProgramDirectUploadTaskColumns = `
  id,
  queue_order AS queueOrder,
  drama_name AS dramaName,
  share_text AS shareText,
  share_key AS shareKey,
  state,
  inferred_episode_count AS inferredEpisodeCount,
  episode_indexes_json AS episodeIndexesJson,
  local_path AS localPath,
  upload_completed_count AS uploadCompletedCount,
  upload_total_count AS uploadTotalCount,
  upload_account_label AS uploadAccountLabel,
  error,
  retry_count AS retryCount,
  created_at AS createdAt,
  updated_at AS updatedAt,
  started_at AS startedAt,
  finished_at AS finishedAt
`

export function migrateWechatMiniProgramDirectUploadTasks(
  database: Database.Database,
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS wechat_miniprogram_direct_upload_tasks (
      id TEXT PRIMARY KEY,
      queue_order INTEGER NOT NULL,
      drama_name TEXT NOT NULL,
      share_text TEXT NOT NULL,
      share_key TEXT NOT NULL,
      state TEXT NOT NULL,
      inferred_episode_count INTEGER,
      episode_indexes_json TEXT,
      local_path TEXT,
      upload_completed_count INTEGER NOT NULL DEFAULT 0,
      upload_total_count INTEGER NOT NULL DEFAULT 0,
      upload_account_label TEXT,
      error TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_wechat_miniprogram_direct_upload_queue
      ON wechat_miniprogram_direct_upload_tasks(state, queue_order);

    CREATE INDEX IF NOT EXISTS idx_wechat_miniprogram_direct_upload_updated
      ON wechat_miniprogram_direct_upload_tasks(updated_at);
  `)
}
