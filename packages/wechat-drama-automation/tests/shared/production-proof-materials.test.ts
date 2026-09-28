import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import {
  getWechatOwnershipProofCounts,
  getWechatOwnershipRequirements,
  loadWechatOwnershipMaterials,
  prepareWechatProductionProofMaterials,
} from "../../src/shared/production-proof-materials.js";
import { configureWechatVideoRuntimeSettings } from "../../src/shared/runtime-settings.js";
import type { Config } from "../../src/shared/types.js";

function image(red: number) {
  return sharp({
    create: {
      width: 64,
      height: 32,
      channels: 3,
      background: { r: red, g: 40, b: 20 },
    },
  }).png().toBuffer();
}

test("defaults to four images of each ownership proof kind", () => {
  configureWechatVideoRuntimeSettings();
  assert.deepEqual(getWechatOwnershipProofCounts(), { jianying: 4, juchuang: 4 });
  assert.deepEqual(getWechatOwnershipRequirements(), { minimumImages: 8 });
});

test("uploads four AI-classified images of each kind without contracts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wechat-production-proof-"));
  const resourceName = "权属规则测试剧";
  const ownershipDir = path.join(root, resourceName, "权属文件");
  await mkdir(ownershipDir, { recursive: true });
  const ownership = Array.from({ length: 8 }, (_, index) =>
    path.join(ownershipDir, `工程${index + 1}.png`));

  try {
    await Promise.all(ownership.map(async (file, index) => writeFile(file, await image(index + 20))));
    configureWechatVideoRuntimeSettings({ localEpisodeVideoRoot: root });
    const config = {
      originalTitle: resourceName,
      playlet: {
        name: resourceName,
        copyright: { productionProofFiles: ["https://example.com/ignored-contract.png"] },
      },
    } as Config;
    const available = await loadWechatOwnershipMaterials(config);
    assert.equal(available.length, 8);

    let aiCalls = 0;
    const aiClient: Parameters<typeof prepareWechatProductionProofMaterials>[1] = {
      analyzeImages: async () => ({
        finishReason: "stop",
        model: "test-vision-model",
        text: JSON.stringify({ kind: ++aiCalls <= 4 ? "jianying" : "juchuang" }),
      }),
      generateImage: async () => { throw new Error("not used"); },
      generateText: async () => { throw new Error("not used"); },
    };
    const files = await prepareWechatProductionProofMaterials(config, aiClient);

    assert.equal(aiCalls, 8);
    assert.deepEqual(files, ownership);
    assert.deepEqual(config.playlet.copyright.productionProofFiles, files);
    assert.ok(files.every((file) => !file.includes("权属工程文件合成")));
  } finally {
    configureWechatVideoRuntimeSettings();
    await rm(root, { recursive: true, force: true });
  }
});

test("uses separate configured counts for download validation and AI upload selection", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wechat-configured-proof-"));
  const resourceName = "自定义权属数量测试剧";
  const ownershipDir = path.join(root, resourceName, "权属文件");
  await mkdir(ownershipDir, { recursive: true });
  const ownership = Array.from({ length: 5 }, (_, index) =>
    path.join(ownershipDir, `工程${index + 1}.png`));

  try {
    await Promise.all(ownership.map(async (file, index) => writeFile(file, await image(index + 30))));
    configureWechatVideoRuntimeSettings({
      localEpisodeVideoRoot: root,
      jianyingOwnershipProofCount: "2",
      juchuangOwnershipProofCount: "3",
    });
    assert.deepEqual(getWechatOwnershipProofCounts(), { jianying: 2, juchuang: 3 });
    assert.deepEqual(getWechatOwnershipRequirements(), { minimumImages: 5 });

    const config = {
      originalTitle: resourceName,
      playlet: { name: resourceName, copyright: {} },
    } as Config;
    assert.equal((await loadWechatOwnershipMaterials(config)).length, 5);
    let aiCalls = 0;
    const aiClient: Parameters<typeof prepareWechatProductionProofMaterials>[1] = {
      analyzeImages: async () => ({
        finishReason: "stop",
        model: "test-vision-model",
        text: JSON.stringify({ kind: ++aiCalls <= 2 ? "jianying" : "juchuang" }),
      }),
      generateImage: async () => { throw new Error("not used"); },
      generateText: async () => { throw new Error("not used"); },
    };

    assert.deepEqual(await prepareWechatProductionProofMaterials(config, aiClient), ownership);
    assert.equal(aiCalls, 5);
  } finally {
    configureWechatVideoRuntimeSettings();
    await rm(root, { recursive: true, force: true });
  }
});
