import assert from "node:assert/strict";
import test from "node:test";

import { taobaoBatchUploadTaskSchema } from "../../src/shared/types.js";

test("validates a local Taobao batch upload task", () => {
  const task = taobaoBatchUploadTaskSchema.parse({
    id: "task-1",
    originalTitle: "逆风翻盘",
    baiduPanResourceLink: "https://pan.baidu.com/s/example?pwd=1234",
    episodeCount: "60",
  });
  assert.equal(task.episodeCount, 60);
  assert.equal(taobaoBatchUploadTaskSchema.safeParse({
    id: "task-2",
    originalTitle: "空集数",
    baiduPanResourceLink: "https://pan.baidu.com/s/example",
    episodeCount: 0,
  }).success, false);
  assert.equal(taobaoBatchUploadTaskSchema.safeParse({
    id: "task-3",
    originalTitle: "超限集数",
    baiduPanResourceLink: "https://pan.baidu.com/s/example",
    episodeCount: 101,
  }).success, false);
});
