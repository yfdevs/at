import type Database from "better-sqlite3"

export function migrateTaobaoImportedTasks(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS taobao_imported_upload_tasks (
      id TEXT PRIMARY KEY,
      dedupe_key TEXT NOT NULL UNIQUE,
      original_title TEXT NOT NULL,
      baidu_pan_resource_link TEXT NOT NULL,
      episode_count INTEGER NOT NULL CHECK (episode_count > 0),
      source_file_name TEXT NOT NULL,
      source_sheet TEXT NOT NULL,
      source_row INTEGER NOT NULL CHECK (source_row > 0),
      status TEXT NOT NULL CHECK (
        status IN ('pending', 'downloading', 'uploading', 'succeeded', 'failed')
      ),
      attempts INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_taobao_imported_tasks_status_created
      ON taobao_imported_upload_tasks(status, created_at);

    CREATE INDEX IF NOT EXISTS idx_taobao_imported_tasks_updated
      ON taobao_imported_upload_tasks(updated_at DESC);
  `)

  const columns = new Set(
    (database.prepare("PRAGMA table_info(taobao_imported_upload_tasks)").all() as Array<{ name: string }>)
      .map((column) => column.name),
  )
  const addColumn = (name: string, definition: string) => {
    if (!columns.has(name)) database.exec(`ALTER TABLE taobao_imported_upload_tasks ADD COLUMN ${definition}`)
  }
  addColumn("drama_tag", "drama_tag TEXT")
  addColumn("episode_summaries_json", "episode_summaries_json TEXT")
  addColumn("synopsis_text", "synopsis_text TEXT")
  addColumn("synopsis_source", "synopsis_source TEXT")
  addColumn("metadata_generated_at", "metadata_generated_at TEXT")
}
