import type { DramaAiClient, ImageGenerationOptions } from "@drama/ai";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { ensureAiPoster } from "../src/ai-poster.js";
import { listLocalPosterImages } from "../src/index.js";

function fakeClient(source: Buffer) {
  let calls = 0;
  const requests: ImageGenerationOptions[] = [];
  const client = {
    analyzeImages: async () => {
      throw new Error("not implemented");
    },
    generateImage: async (options: ImageGenerationOptions) => {
      calls += 1;
      requests.push(options);
      return {
        images: [{ data: source, mimeType: "image/png" }],
        model: options.model || "test-image-model",
      };
    },
    generateText: async () => {
      throw new Error("not implemented");
    },
  } satisfies DramaAiClient;
  return { client, getCalls: () => calls, requests };
}

test("preserves the generated source dimensions and format and reuses the matching cache", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "drama-ai-poster-"));
  try {
    const source = await sharp({
      create: {
        background: "#7f1d1d",
        channels: 3,
        height: 900,
        width: 1600,
      },
    }).png().toBuffer();
    const fake = fakeClient(source);
    const options = {
      client: fake.client,
      localMaterialRoot: root,
      model: "test-image-model",
      resourceName: "测试短剧",
      summary: "主角在绝境中觉醒能力，揭开阴谋并完成逆袭。",
      title: "测试短剧",
    };

    const [first, concurrent] = await Promise.all([
      ensureAiPoster(options),
      ensureAiPoster(options),
    ]);
    const second = await ensureAiPoster(options);
    const metadata = await sharp(first.file).metadata();
    const fileStat = await stat(first.file);
    const savedData = await readFile(first.file);
    const discoveredPosters = await listLocalPosterImages({
      root,
      resourceName: "测试短剧",
    });

    assert.equal(fake.getCalls(), 1);
    assert.equal(first.file, concurrent.file);
    assert.equal(second.reused, true);
    assert.equal(metadata.width, 1600);
    assert.equal(metadata.height, 900);
    assert.equal(metadata.format, "png");
    assert.deepEqual(savedData, source);
    assert.equal(discoveredPosters[0]?.file, first.file);
    assert.equal(fileStat.size, source.length);
    assert.match(first.file, /海报封面/);
    assert.match(first.file, /AI海报\.png$/);
    assert.equal(fake.requests[0]?.size, undefined);
    assert.match(fake.requests[0]?.prompt ?? "", /剧名：测试短剧/);
    assert.match(fake.requests[0]?.prompt ?? "", /主角在绝境中觉醒能力/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("regenerates when the synopsis changes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "drama-ai-poster-"));
  try {
    const source = await sharp({
      create: {
        background: "#1d4ed8",
        channels: 3,
        height: 800,
        width: 600,
      },
    }).png().toBuffer();
    const fake = fakeClient(source);
    const base = {
      client: fake.client,
      localMaterialRoot: root,
      model: "test-image-model",
      resourceName: "同名短剧",
      title: "同名短剧",
    };

    await ensureAiPoster({ ...base, summary: "第一版剧情简介。" });
    const regenerated = await ensureAiPoster({ ...base, summary: "第二版剧情简介。" });

    assert.equal(fake.getCalls(), 2);
    assert.equal(regenerated.reused, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
