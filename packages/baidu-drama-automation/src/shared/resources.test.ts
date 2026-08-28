import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { readImageDimensions } from "@drama/drama-media-assets";
import {
  BAIDU_DRAMA_LANDSCAPE_COVER_SIZE,
  BAIDU_DRAMA_PORTRAIT_COVER_SIZE,
  prepareBaiduDramaCoverVariants,
} from "./resources.js";

test("stretches one source into distinct 16:9 and 3:4 Baidu cover files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "baidu-drama-cover-"));
  try {
    const messages: string[] = [];
    const sourceFile = path.join(root, "source-cover.svg");
    await writeFile(
      sourceFile,
      `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200">` +
        `<rect width="1600" height="1200" fill="#c62828"/>` +
        `<circle cx="800" cy="600" r="300" fill="#ffd54f"/>` +
      `</svg>`,
      "utf8",
    );

    const result = await prepareBaiduDramaCoverVariants({
      sourceFile,
      outputDir: path.join(root, "output"),
      onLog: (message) => messages.push(message),
    });

    assert.notEqual(result.landscape.file, result.portrait.file);
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
    assert.equal(messages.length, 2);
    assert.ok(messages.every((message) => message.includes("拉伸生成图片")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
