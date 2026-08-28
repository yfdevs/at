import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateKuaishouAdCoverCrop,
  prepareKuaishouAdUnlockCover,
  resolveKuaishouVariantCoverFile,
  type KuaishouAdCoverAnalysis,
} from "./ad-cover-ai.js";
import type {
  KuaishouDramaPublishVariant,
  KuaishouDramaTaskConfig,
} from "./types.js";

const baseAnalysis: KuaishouAdCoverAnalysis = {
  titleRegions: [{ x1: 0, y1: 0, x2: 1000, y2: 80 }],
  subjectBox: { x1: 200, y1: 250, x2: 600, y2: 650 },
  recommendedCrop: { x1: 100, y1: 100, x2: 700, y2: 900 },
  confidence: 0.92,
};

void test("calculates an in-bounds 3:4 crop that retains the main subject", () => {
  const crop = calculateKuaishouAdCoverCrop(baseAnalysis, {
    width: 1000,
    height: 1600,
  });

  assert.equal(crop.width / crop.height, 3 / 4);
  assert.ok(crop.left >= 0 && crop.top >= 0);
  assert.ok(crop.left + crop.width <= 1000);
  assert.ok(crop.top + crop.height <= 1600);
});

void test("rejects an image when no title-free crop retains enough subject", () => {
  assert.throws(() => calculateKuaishouAdCoverCrop({
    ...baseAnalysis,
    titleRegions: [{ x1: 100, y1: 300, x2: 700, y2: 500 }],
  }, { width: 1000, height: 1600 }), /KUAISHOU_AD_COVER_CROP_INVALID/);
});

void test("falls back to the largest title-free area when the AI crop cuts off subjects", () => {
  const crop = calculateKuaishouAdCoverCrop({
    titleRegions: [{ x1: 0, y1: 600, x2: 1000, y2: 970 }],
    subjectBox: { x1: 70, y1: 130, x2: 730, y2: 590 },
    recommendedCrop: { x1: 80, y1: 0, x2: 520, y2: 590 },
    confidence: 0.95,
  }, { width: 828, height: 1167 });

  assert.equal(crop.width / crop.height, 3 / 4);
  assert.ok(crop.left + crop.width >= 550);
  assert.ok(crop.top + crop.height <= 650);
});

void test("selects the generated cover only for the ad-unlock variant", () => {
  const task = {
    localCoverFile: "original.jpg",
    localAdUnlockCoverFile: "ad-cover.jpg",
  } as KuaishouDramaTaskConfig;
  const variant = (kind: KuaishouDramaPublishVariant["kind"]) => ({
    kind,
  }) as KuaishouDramaPublishVariant;

  assert.equal(resolveKuaishouVariantCoverFile(task, variant("full-paid")), "original.jpg");
  assert.equal(resolveKuaishouVariantCoverFile(task, variant("ad-unlock")), "ad-cover.jpg");
});

void test("uses the original cover for ad-unlock when AI is not configured", async () => {
  const task = { localCoverFile: "original.jpg" } as KuaishouDramaTaskConfig;
  const logs: string[] = [];

  const result = await prepareKuaishouAdUnlockCover(task, {
    onLog: (message) => logs.push(message),
  });

  assert.equal(result, "original.jpg");
  assert.equal(task.localAdUnlockCoverFile, "original.jpg");
  assert.equal(
    resolveKuaishouVariantCoverFile(
      { localCoverFile: "fallback.jpg" } as KuaishouDramaTaskConfig,
      { kind: "ad-unlock" } as KuaishouDramaPublishVariant,
    ),
    "fallback.jpg",
  );
  assert.match(logs.join("\n"), /使用原始封面|using the original cover/);
});
