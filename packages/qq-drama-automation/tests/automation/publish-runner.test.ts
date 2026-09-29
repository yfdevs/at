import assert from "node:assert/strict";
import test from "node:test";

import { qqDramaAddPageRecoveryAction } from "../../src/automation/publish-runner.js";

test("recovers a stale QQ submission success page before the next task", () => {
  assert.equal(
    qqDramaAddPageRecoveryAction(
      "QQ漫剧创作者平台 漫剧提交成功 剧目已提交审核 剧目 ID：725961270905540608 继续添加 返回漫剧列表",
    ),
    "continue-adding",
  );
});

test("does not treat the normal add form as a stale success page", () => {
  assert.equal(
    qqDramaAddPageRecoveryAction("上传短剧 作品名称 审核通过后不支持修改 下一步"),
    undefined,
  );
});

test("requires the continue action before attempting success-page recovery", () => {
  assert.equal(
    qqDramaAddPageRecoveryAction("漫剧提交成功 剧目已提交审核 返回漫剧列表"),
    undefined,
  );
});
