import type { DramaAiClient, ImageGenerationOptions } from "@drama/ai";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import { readImageDimensions } from "@drama/drama-media-assets";
import {
  BAIDU_DRAMA_LANDSCAPE_COVER_SIZE,
  BAIDU_DRAMA_PORTRAIT_COVER_SIZE,
  cleanupBaiduAiCoverTemporaryFile,
  prepareBaiduDramaCoverVariants,
} from "./resources.js";

function fakeAiClient() {
  const requests: ImageGenerationOptions[] = [];
  const client = {
    analyzeImages: async () => {
      throw new Error("not implemented");
    },
    generateImage: async (options: ImageGenerationOptions) => {
      requests.push(options);
      const portrait = options.size === "1536x2048";
      const data = await sharp({
        create: {
          background: portrait ? "#1d4ed8" : "#b91c1c",
          channels: 3,
          height: portrait ? 1200 : 900,
          width: portrait ? 900 : 1600,
        },
      }).png().toBuffer();
      return {
        images: [{ data, mimeType: "image/png" }],
        model: options.model || "test-image-model",
      };
    },
    generateText: async () => {
      throw new Error("not implemented");
    },
  } satisfies DramaAiClient;
  return { client, requests };
}

async function writeSvg(file: string, width: number, height: number, color: string) {
  await writeFile(
    file,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect width="${width}" height="${height}" fill="${color}"/>` +
      `<circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 4}" fill="#ffd54f"/>` +
    `</svg>`,
    "utf8",
  );
}

async function assertBaiduCoverDimensions(result: Awaited<ReturnType<typeof prepareBaiduDramaCoverVariants>>) {
  assert.deepEqual(
    await readImageDimensions(result.landscape.file),
    BAIDU_DRAMA_LANDSCAPE_COVER_SIZE,
  );
  assert.deepEqual(
    await readImageDimensions(result.portrait.file),
    BAIDU_DRAMA_PORTRAIT_COVER_SIZE,
  );
  assert.ok((await stat(result.landscape.file)).size > 0);
  assert.ok((await stat(result.portrait.file)).size > 0);
}

test("retries a locked AI cover temporary file without failing the task", async () => {
  let attempts = 0;
  const warnings: string[] = [];
  const cleaned = await cleanupBaiduAiCoverTemporaryFile("locked.image", {
    maxAttempts: 5,
    onWarning: (message) => warnings.push(message),
    removeFile: async () => {
      attempts += 1;
      if (attempts < 3) {
        throw Object.assign(new Error("file is locked"), { code: "EPERM" });
      }
    },
    wait: async () => undefined,
  });

  assert.equal(cleaned, true);
  assert.equal(attempts, 3);
  assert.deepEqual(warnings, []);
});

test("ignores a persistent AI cover temporary file cleanup failure", async () => {
  let attempts = 0;
  const warnings: string[] = [];
  const cleaned = await cleanupBaiduAiCoverTemporaryFile("locked.image", {
    maxAttempts: 3,
    onWarning: (message) => warnings.push(message),
    removeFile: async () => {
      attempts += 1;
      throw Object.assign(new Error("file is still locked"), { code: "EPERM" });
    },
    wait: async () => undefined,
  });

  assert.equal(cleaned, false);
  assert.equal(attempts, 3);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /已忽略并等待定时清理/);
});

test("uses existing landscape and portrait covers without AI or stretching", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "baidu-drama-cover-"));
  try {
    const landscapeFile = path.join(root, "landscape.svg");
    const portraitFile = path.join(root, "portrait.svg");
    await Promise.all([
      writeSvg(landscapeFile, 1600, 900, "#c62828"),
      writeSvg(portraitFile, 900, 1200, "#1565c0"),
    ]);
    const messages: string[] = [];
    const result = await prepareBaiduDramaCoverVariants({
      sourceFile: portraitFile,
      landscapeSourceFile: landscapeFile,
      portraitSourceFile: portraitFile,
      title: "双封面测试剧",
      outputDir: path.join(root, "output"),
      createAiClient: () => {
        throw new Error("AI should not be called");
      },
      onLog: (message) => messages.push(message),
    });

    await assertBaiduCoverDimensions(result);
    assert.ok(messages.some((message) => message.includes("等比裁剪生成图片")));
    assert.ok(messages.every((message) => !message.includes("拉伸生成图片")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generates a missing 16:9 cover from the 3:4 cover and reuses the AI cache", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "baidu-drama-cover-"));
  try {
    const portraitFile = path.join(root, "portrait.svg");
    await writeSvg(portraitFile, 900, 1200, "#1565c0");
    const fake = fakeAiClient();
    const common = {
      sourceFile: portraitFile,
      portraitSourceFile: portraitFile,
      title: "竖版补横版测试剧",
      aiCacheDir: path.join(root, "cache"),
      aiImageModel: "test-image-model",
      createAiClient: () => fake.client,
    };

    const first = await prepareBaiduDramaCoverVariants({
      ...common,
      outputDir: path.join(root, "output-1"),
    });
    const second = await prepareBaiduDramaCoverVariants({
      ...common,
      outputDir: path.join(root, "output-2"),
    });

    await assertBaiduCoverDimensions(first);
    await assertBaiduCoverDimensions(second);
    assert.equal(fake.requests.length, 1);
    assert.equal(fake.requests[0]?.size, "2560x1440");
    assert.deepEqual(fake.requests[0]?.referenceImages, [{ type: "file", path: portraitFile }]);
    assert.match(fake.requests[0]?.prompt ?? "", /16:9 横版/);
    assert.match(fake.requests[0]?.prompt ?? "", /不要简单拉伸/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generates a missing 3:4 cover from the 16:9 cover", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "baidu-drama-cover-"));
  try {
    const landscapeFile = path.join(root, "landscape.svg");
    await writeSvg(landscapeFile, 1600, 900, "#c62828");
    const fake = fakeAiClient();
    const result = await prepareBaiduDramaCoverVariants({
      sourceFile: landscapeFile,
      landscapeSourceFile: landscapeFile,
      title: "横版补竖版测试剧",
      outputDir: path.join(root, "output"),
      aiCacheDir: path.join(root, "cache"),
      aiImageModel: "test-image-model",
      createAiClient: () => fake.client,
    });

    await assertBaiduCoverDimensions(result);
    assert.equal(fake.requests.length, 1);
    assert.equal(fake.requests[0]?.size, "1536x2048");
    assert.deepEqual(fake.requests[0]?.referenceImages, [{ type: "file", path: landscapeFile }]);
    assert.match(fake.requests[0]?.prompt ?? "", /3:4 竖版/);
    assert.match(fake.requests[0]?.prompt ?? "", /不要简单拉伸/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
