import assert from "node:assert/strict";
import test from "node:test";

import { findFailedEpisodeUploads } from "../../src/automation/publish-runner.js";

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
