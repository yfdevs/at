import assert from "node:assert/strict";
import test from "node:test";

import { createKuaishouDramaPublishVariants } from "./publish-variants.js";
import {
  kuaishouDramaTaskSchema,
  type KuaishouDramaPublishType,
} from "./types.js";

function task(publishType?: KuaishouDramaPublishType) {
  return kuaishouDramaTaskSchema.parse({
    title: "测试短剧",
    episodeCount: 10,
    publishType,
    fullDramaPriceYuan: 4.9,
    summary: "这是一段用于验证快手短剧发布版本选择逻辑的剧情简介。".repeat(4),
    genderChannel: "不限",
    categories: ["脑洞"],
    plotTags: ["其他"],
    productionOrganization: "测试制作方",
  });
}

void test("publishes both variants when publishType is empty", () => {
  assert.deepEqual(
    createKuaishouDramaPublishVariants(task()).map((item) => item.kind),
    ["full-paid", "ad-unlock"],
  );

  for (const publishType of [null, "", "   "]) {
    const parsed = kuaishouDramaTaskSchema.parse({
      ...task(),
      publishType,
    });
    assert.equal(parsed.publishType, undefined);
  }
});

void test("publishes only the paid variant when publishType is 付费", () => {
  assert.deepEqual(
    createKuaishouDramaPublishVariants(task("付费")).map((item) => item.kind),
    ["full-paid"],
  );
});

void test("publishes only the ad variant when publishType is 广告", () => {
  assert.deepEqual(
    createKuaishouDramaPublishVariants(task("广告")).map((item) => item.kind),
    ["ad-unlock"],
  );
});
