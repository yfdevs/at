// oxlint-disable typescript/no-floating-promises
import assert from "node:assert/strict";
import test from "node:test";

import { createMockIqiyiDramaTask } from "../api/task.js";
import { buildIqiyiLandscapeCoverPrompt } from "./materials.js";

test("requires AI to render the exact title with ocean-fantasy poster typography", () => {
  const task = createMockIqiyiDramaTask();
  const prompt = buildIqiyiLandscapeCoverPrompt(task.playlet);

  assert.match(prompt, /必须由图片生成模型直接在海报画面中绘制完整中文剧名/u);
  assert.match(prompt, /赶海救下美人鱼，她让整片大海来报恩/u);
  assert.match(prompt, /海洋奇幻商业海报艺术字/u);
  assert.match(prompt, /青蓝到银白的通透渐变/u);
  assert.match(prompt, /禁止使用普通默认字体/u);
  assert.match(prompt, /最终画面只保留一次完整剧名/u);
  assert.match(prompt, /不要新增平台标志、品牌标志、水印/u);
});
