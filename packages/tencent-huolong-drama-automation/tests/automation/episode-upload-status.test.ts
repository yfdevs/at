import assert from "node:assert/strict";
import test from "node:test";

import {
  findFailedEpisodeUploads,
  parseTencentHuolongEpisodeUploadProgress,
  splitTencentHuolongEpisodeUploadBatches,
} from "../../src/automation/publish-runner.js";

test("finds failed episode rows without treating successful rows as failed", () => {
  assert.deepEqual(findFailedEpisodeUploads([
    { episodeNumber: "1", title: "车位风波 - 第1集", statuses: ["上传失败"] },
    { episodeNumber: "2", title: "车位风波 - 第2集", statuses: ["上传成功"] },
    { episodeNumber: "3", title: "车位风波 - 第3集", statuses: ["上传失败"] },
  ]), [
    { episodeNumber: "1", title: "车位风波 - 第1集" },
    { episodeNumber: "3", title: "车位风波 - 第3集" },
  ]);
});

test("splits episode uploads at the Tencent 60-file selection limit", () => {
  const files = Array.from({ length: 125 }, (_, index) => `episode-${index + 1}.mp4`);
  const batches = splitTencentHuolongEpisodeUploadBatches(files);

  assert.deepEqual(batches.map((batch) => batch.length), [60, 60, 5]);
  assert.deepEqual(batches.flat(), files);
});

test("parses Tencent episode upload progress", () => {
  assert.deepEqual(
    parseTencentHuolongEpisodeUploadProgress(["其他标题", "正在上传（58/60）"]),
    { completed: 58, total: 60 },
  );
  assert.deepEqual(
    parseTencentHuolongEpisodeUploadProgress(["上传完成 (5 / 5)"]),
    { completed: 5, total: 5 },
  );
  assert.equal(parseTencentHuolongEpisodeUploadProgress(["请选择视频"]), undefined);
});
