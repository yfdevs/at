// oxlint-disable typescript/no-floating-promises
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createIqiyiDramaTaskFixture } from "../fixtures/task-fixture.js";
import { buildIqiyiLandscapeCoverPrompt, prepareIqiyiMaterials } from "../../src/shared/materials.js";

test("requires AI to render the exact short-drama title with matching poster typography", () => {
  const task = createIqiyiDramaTaskFixture();
  const prompt = buildIqiyiLandscapeCoverPrompt(task.playlet);

  assert.match(prompt, /必须由图片生成模型直接在海报画面中绘制完整中文剧名/u);
  assert.match(prompt, /爱奇艺自动化测试剧/u);
  assert.match(prompt, /都市逆袭商业海报艺术字/u);
  assert.match(prompt, /金属金或亮白渐变/u);
  assert.match(prompt, /禁止使用普通默认字体/u);
  assert.match(prompt, /最终画面只保留一次完整剧名/u);
  assert.match(prompt, /不要新增平台标志、品牌标志、水印/u);
});

test("requires local episode videos for short-drama materials", async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "iqiyi-short-drama-materials-"));
  const task = createIqiyiDramaTaskFixture();
  task.originalTitle = "短剧正片素材测试";
  task.playlet.dramaType = "short-drama";
  task.playlet.episodeCount = 2;
  await mkdir(path.join(fixtureRoot, task.originalTitle), { recursive: true });

  try {
    await assert.rejects(
      () => prepareIqiyiMaterials(task, {
        localMaterialRoot: fixtureRoot,
        assetDownloadDir: path.join(fixtureRoot, "assets"),
      }),
      /\[local-video-invalid\]/u,
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
