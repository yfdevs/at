import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import {
  classifyOwnershipProjectProof,
  classifyOwnershipProjectProofName,
  classifyOwnershipProjectProofHash,
  selectOwnershipProjectProofFiles,
  type ClassifiedOwnershipProjectProof,
} from "../src/index.js";

function proof(index: number, kind: ClassifiedOwnershipProjectProof["kind"]) {
  return {
    kind,
    material: {
      index,
      name: `测试剧 - 权属工程文件${index}.png`,
      file: `D:\\素材\\测试剧 - 权属工程文件${index}.png`,
      size: 1000 + index,
    },
  } satisfies ClassifiedOwnershipProjectProof;
}

test("prefers explicit proof source names", () => {
  assert.equal(classifyOwnershipProjectProofName("剪映1.png"), "jianying");
  assert.equal(classifyOwnershipProjectProofName("Jianying 2.PNG"), "jianying");
  assert.equal(classifyOwnershipProjectProofName("CapCut-3.jpg"), "jianying");
  assert.equal(classifyOwnershipProjectProofName("剧创1.png"), "juchuang");
  assert.equal(classifyOwnershipProjectProofName("即梦 2.png"), "juchuang");
  assert.equal(classifyOwnershipProjectProofName("jimeng-3.webp"), "juchuang");
  assert.equal(classifyOwnershipProjectProofName("测试剧 - 权属工程文件1.png"), undefined);
});

test("recognizes expanded and legacy 剪映 top-left logo fingerprints", () => {
  assert.equal(classifyOwnershipProjectProofHash(0x83d8262e26328820n), "jianying");
  assert.equal(classifyOwnershipProjectProofHash(0x05b846466e629000n), "jianying");
  assert.equal(classifyOwnershipProjectProofHash(0x23d02b2b2333cc22n), "jianying");
  assert.equal(classifyOwnershipProjectProofHash(0xb289b635b535b5ean), "jianying");
  assert.equal(classifyOwnershipProjectProofHash(0x0000000010203430n), "juchuang");
  assert.equal(classifyOwnershipProjectProofHash(0x858d9c9c8d018801n), "juchuang");
  assert.equal(classifyOwnershipProjectProofHash(0x0202020222426a62n), "juchuang");
  assert.equal(classifyOwnershipProjectProofHash(0x004000e1e5e5e541n), "juchuang");
  assert.equal(classifyOwnershipProjectProofHash(0x101c4c2d4f4f4f1cn), "juchuang");
});

test("classifies explicitly named parent directories without opening the image", async () => {
  assert.equal(
    await classifyOwnershipProjectProof("D:\\素材\\权属文件\\剪映\\工程1.png", "工程1.png"),
    "jianying",
  );
  assert.equal(
    await classifyOwnershipProjectProof("D:\\素材\\权属文件\\剧创\\工程1.png", "工程1.png"),
    "juchuang",
  );
});

test("classifies normalized dark and light application shells and rejects non-screenshots", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ownership-project-proof-"));
  try {
    const darkScreenshot = path.join(root, "工程1.png");
    const lightScreenshot = path.join(root, "工程2.png");
    const portraitLikeImage = path.join(root, "工程3.png");
    await Promise.all([
      sharp({ create: { width: 1920, height: 1080, channels: 3, background: "#303438" } })
        .png()
        .toFile(darkScreenshot),
      sharp({ create: { width: 1920, height: 1080, channels: 3, background: "#f2f2f2" } })
        .png()
        .toFile(lightScreenshot),
      sharp({ create: { width: 1200, height: 1000, channels: 3, background: "#303438" } })
        .png()
        .toFile(portraitLikeImage),
    ]);

    assert.equal(await classifyOwnershipProjectProof(darkScreenshot), "jianying");
    assert.equal(await classifyOwnershipProjectProof(lightScreenshot), "juchuang");
    assert.equal(await classifyOwnershipProjectProof(portraitLikeImage), "unknown");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("selects the first two numbered screenshots from each proof source", () => {
  const selection = selectOwnershipProjectProofFiles([
    proof(10, "jianying"),
    proof(4, "juchuang"),
    proof(3, "jianying"),
    proof(2, "juchuang"),
    proof(1, "jianying"),
    proof(8, "juchuang"),
  ]);

  assert.deepEqual(selection.jianying.map((item) => item.index), [1, 3]);
  assert.deepEqual(selection.juchuang.map((item) => item.index), [2, 4]);
  assert.deepEqual(selection.files, [
    "D:\\素材\\测试剧 - 权属工程文件1.png",
    "D:\\素材\\测试剧 - 权属工程文件3.png",
    "D:\\素材\\测试剧 - 权属工程文件2.png",
    "D:\\素材\\测试剧 - 权属工程文件4.png",
  ]);
});

test("fails before platform automation when either proof source has fewer than two images", () => {
  assert.throws(
    () => selectOwnershipProjectProofFiles([
      proof(1, "jianying"),
      proof(2, "juchuang"),
      proof(4, "juchuang"),
    ]),
    /剪映=1\/2，剧创=2\/2/u,
  );
});

test("reports unrecognized images instead of treating them as 剧创", () => {
  assert.throws(
    () => selectOwnershipProjectProofFiles([
      proof(1, "jianying"),
      proof(2, "juchuang"),
      proof(3, "unknown"),
    ]),
    /剪映=1\/2，剧创=1\/2，未识别=1.*权属工程文件3\.png/u,
  );
});
