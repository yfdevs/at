import type Database from "better-sqlite3";

export function migratePinduoduoUploadRecords(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS pinduoduo_approved_upload_records (
      platform_apply_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      episode_count INTEGER,
      demo_url TEXT,
      status TEXT NOT NULL,
      stage TEXT,
      error_message TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT,
      account_profile_name TEXT,
      uploaded_at TEXT,
      last_attempt_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pinduoduo_approved_upload_records_status_updated
      ON pinduoduo_approved_upload_records(status, updated_at);
  `);
}
