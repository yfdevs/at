// oxlint-disable typescript/no-floating-promises
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createIqiyiDramaTaskFixture } from "../fixtures/task-fixture.js";
import {
  buildIqiyiLandscapeCoverPrompt,
  evaluateIqiyiLandscapeCoverValidation,
  prepareIqiyiMaterials,
} from "../../src/shared/materials.js";

test("requires a readable title while allowing normal supporting poster copy", () => {
  const task = createIqiyiDramaTaskFixture();
  const prompt = buildIqiyiLandscapeCoverPrompt(task.playlet);

  assert.match(prompt, /必须由图片生成模型直接在海报画面中绘制完整中文剧名/u);
  assert.match(prompt, /爱奇艺自动化测试剧/u);
  assert.match(prompt, /都市逆袭商业海报艺术字/u);
  assert.match(prompt, /金属金或亮白渐变/u);
  assert.match(prompt, /禁止使用普通默认字体/u);
  assert.match(prompt, /允许为艺术效果重复局部标题字样/u);
  assert.match(prompt, /平台或品牌标志、水印/u);
  assert.match(prompt, /地点、年代、人物身份、剧情氛围词/u);
  assert.doesNotMatch(prompt, /整张图只能出现一处/u);
  assert.doesNotMatch(prompt, /16:9|1920x1080/u);
});

test("accepts punctuation differences, split title OCR, repetition, and relevant location copy", () => {
  const result = evaluateIqiyiLandscapeCoverValidation("吾儿亲启，珠间血海", {
    titlePresent: false,
    titleReadable: false,
    titleSeverelyIncorrect: true,
    hasProhibitedOverlay: false,
    hasClearlyUnrelatedOrGibberishText: false,
    detectedTexts: ["吾儿亲启", "吾儿亲启", "珠间血海", "扬州"],
    blockingIssues: [
      "未出现带逗号的完整准确剧名“吾儿亲启，珠间血海”",
      "“吾儿亲启”内容多次重复出现，不符合剧名仅出现一次的要求",
      "存在无关文字“扬州”",
    ],
    warnings: ["存在辅助地点文字“扬州”"],
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.failures, []);
  assert.equal(result.warnings.length, 4);
});

test("still rejects missing or clearly invalid cover text", () => {
  const result = evaluateIqiyiLandscapeCoverValidation("正确剧名", {
    titlePresent: false,
    titleReadable: false,
    titleSeverelyIncorrect: true,
    hasProhibitedOverlay: true,
    hasClearlyUnrelatedOrGibberishText: true,
    detectedTexts: ["另一部短剧", "扫码加微信", "1920x1080"],
    blockingIssues: ["出现另一部作品名称"],
    warnings: [],
  });

  assert.equal(result.passed, false);
  assert.match(result.failures.join("；"), /未检测到完整剧名/u);
  assert.match(result.failures.join("；"), /广告、水印、二维码或技术界面文字/u);
  assert.match(result.failures.join("；"), /无关的其他作品文字或乱码/u);
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
