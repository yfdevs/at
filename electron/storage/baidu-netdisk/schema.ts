import type Database from "better-sqlite3";

export const selectBaiduNetdiskDownloadRecordColumns = `
  id,
  share_key AS shareKey,
  share_text AS shareText,
  resource_name AS resourceName,
  local_episode_video_root AS localEpisodeVideoRoot,
  episode_count AS episodeCount,
  download_dir AS downloadDir,
  local_path AS localPath,
  progress_percent AS progressPercent,
  transferred_bytes AS transferredBytes,
  total_bytes AS totalBytes,
  speed_text AS speedText,
  native_status AS nativeStatus,
  state,
  skipped_existing AS skippedExisting,
  error,
  created_at AS createdAt,
  updated_at AS updatedAt,
  started_at AS startedAt,
  completed_at AS completedAt
`;

export function migrateBaiduNetdiskDownloadRecords(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS baidu_netdisk_download_records (
      id TEXT PRIMARY KEY,
      share_key TEXT NOT NULL,
      share_text TEXT NOT NULL,
      resource_name TEXT NOT NULL,
      local_episode_video_root TEXT,
      episode_count INTEGER,
      download_dir TEXT NOT NULL,
      local_path TEXT,
      progress_percent REAL,
      transferred_bytes INTEGER,
      total_bytes INTEGER,
      speed_text TEXT,
      native_status TEXT,
      state TEXT NOT NULL,
      skipped_existing INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_baidu_download_records_updated_at
      ON baidu_netdisk_download_records(updated_at);

    CREATE INDEX IF NOT EXISTS idx_baidu_download_records_state
      ON baidu_netdisk_download_records(state, updated_at);
  `);
}
