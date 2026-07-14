import type Database from "better-sqlite3";

export function migratePinduoduoApplyRecords(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS pinduoduo_apply_records (
      account_task_id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      account_profile_name TEXT,
      pinduoduo_account_id TEXT,
      pinduoduo_account_name TEXT,
      title TEXT NOT NULL,
      original_title TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      platform_apply_id INTEGER,
      platform_title TEXT NOT NULL,
      platform_status INTEGER,
      platform_reject_reason TEXT,
      audit_status TEXT NOT NULL,
      video_status TEXT NOT NULL,
      raw_json TEXT,
      submitted_at TEXT,
      last_checked_at TEXT,
      next_check_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pinduoduo_apply_records_platform_apply_id
      ON pinduoduo_apply_records(platform_apply_id);

    CREATE INDEX IF NOT EXISTS idx_pinduoduo_apply_records_audit_due
      ON pinduoduo_apply_records(audit_status, next_check_at);

    CREATE INDEX IF NOT EXISTS idx_pinduoduo_apply_records_video_ready
      ON pinduoduo_apply_records(audit_status, video_status);
  `);
}
