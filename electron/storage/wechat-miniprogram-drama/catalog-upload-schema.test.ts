import assert from "node:assert/strict"
import test from "node:test"
import Database from "better-sqlite3"

import { migrateWechatMiniProgramCatalogUploadTasks } from "./catalog-upload-schema"

test("catalog upload migration removes dramas that have not passed audit", () => {
  const database = new Database(":memory:")
  try {
    migrateWechatMiniProgramCatalogUploadTasks(database)
    const insert = database.prepare(`
      INSERT INTO wechat_miniprogram_catalog_upload_tasks (
        id, drama_id, drama_name, episode_count, audit_status, state,
        target_episode_count, created_at, updated_at
      ) VALUES (
        @id, @dramaId, @dramaName, 10, @auditStatus, 'discovered',
        4, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      )
    `)
    insert.run({ id: "approved", dramaId: 1, dramaName: "审核通过", auditStatus: 3 })
    insert.run({ id: "rejected", dramaId: 2, dramaName: "审核不通过", auditStatus: 2 })
    insert.run({ id: "legacy", dramaId: 3, dramaName: "旧数据", auditStatus: null })

    migrateWechatMiniProgramCatalogUploadTasks(database)

    const rows = database.prepare(`
      SELECT id, audit_status AS auditStatus
      FROM wechat_miniprogram_catalog_upload_tasks
      ORDER BY drama_id
    `).all()
    assert.deepEqual(rows, [{ id: "approved", auditStatus: 3 }])
  } finally {
    database.close()
  }
})
