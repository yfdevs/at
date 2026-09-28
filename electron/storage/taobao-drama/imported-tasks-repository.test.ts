import assert from "node:assert/strict"
import test from "node:test"
import Database from "better-sqlite3"

import { TaobaoImportedTasksRepository } from "./imported-tasks-repository"

function input(title = "逆风翻盘") {
  return {
    originalTitle: title,
    baiduPanResourceLink: "https://pan.baidu.com/s/example?pwd=1234",
    episodeCount: 60,
    sourceFileName: "淘宝任务.xlsx",
    sourceSheet: "上传清单",
    sourceRow: 2,
  }
}

test("imports, deduplicates and completes Taobao database tasks", () => {
  const repository = new TaobaoImportedTasksRepository(new Database(":memory:"))
  try {
    assert.deepEqual(repository.importTasks([input(), input()]), { imported: 1, skipped: 1 })
    assert.equal(repository.summary().pending, 1)

    const claimed = repository.claimNext()
    assert.ok(claimed)
    assert.equal(claimed.status, "downloading")
    assert.equal(claimed.attempts, 1)

    repository.saveGeneratedMetadata(claimed.id, {
      dramaTag: "都市",
      episodeSummaries: Array.from({ length: 60 }, (_, index) => `第${index + 1}集概括`),
      synopsisText: "测试简介",
      synopsisSource: "简介.txt",
    })
    const enriched = repository.list()[0]
    assert.equal(enriched?.dramaTag, "都市")
    assert.equal(enriched?.episodeSummaries?.length, 60)
    assert.equal(enriched?.synopsisSource, "简介.txt")

    repository.markProgress(claimed.id, "uploading")
    repository.complete(claimed.id, false, "测试失败")
    assert.equal(repository.summary().failed, 1)
    assert.equal(repository.list()[0]?.errorMessage, "测试失败")

    assert.equal(repository.retry(claimed.id), true)
    assert.equal(repository.summary().pending, 1)
  } finally {
    repository.close()
  }
})

test("recovers interrupted Taobao database tasks", () => {
  const repository = new TaobaoImportedTasksRepository(new Database(":memory:"))
  try {
    repository.importTasks([input("中断任务")])
    assert.ok(repository.claimNext())
    assert.equal(repository.recoverInterrupted(), 1)
    const task = repository.list()[0]
    assert.equal(task?.status, "pending")
    assert.match(task?.errorMessage ?? "", /重新排队/)
  } finally {
    repository.close()
  }
})
