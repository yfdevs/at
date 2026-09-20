import assert from "node:assert/strict";
import test from "node:test";

import { taobaoDramaTaskPayloadSchema } from "../../src/shared/types.js";

test("validates the dynamic Taobao backend fields", () => {
  const payload = taobaoDramaTaskPayloadSchema.parse({
    title: "逆风翻盘",
    summary: "女主从低谷重新出发并改变人生。",
    episodeCount: "60",
    shortDramaType: "AI仿真人短剧",
    shortDramaTags: ["都市", "AI真人演绎剧", "逆袭"],
    audience: "女",
  });
  assert.equal(payload.episodeCount, 60);
  assert.deepEqual(payload.shortDramaTags, ["都市", "AI真人演绎剧", "逆袭"]);
  assert.equal(payload.audience, "女");

  assert.equal(taobaoDramaTaskPayloadSchema.safeParse({
    title: "缺少标签",
    summary: "这个任务缺少用户选择的短剧标签。",
    episodeCount: 10,
    shortDramaType: "AI仿真人短剧",
    shortDramaTags: [],
    audience: "女",
  }).success, false);
});
