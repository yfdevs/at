import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import {
  classifyOwnershipProjectProof,
  classifyOwnershipProjectProofName,
  findOwnershipProjectProofFiles,
  selectOwnershipProjectProofFiles,
  type ClassifiedOwnershipProjectProof,
} from "../src/index.js";
import { ownershipProjectProofOcrTextContainsJianying } from
  "../src/ownership-project-proof-ocr.js";

const liveOwnershipProofDirectory =
  "D:\\BaiduNetdiskDownload\\装够了，本宫天下无敌\\权属文件";

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

test("recognizes 剪映 from OCR text and its common wordmark misreadings", () => {
  assert.equal(ownershipProjectProofOcrTextContainsJianying("剪 映  菜单"), true);
  assert.equal(
    ownershipProjectProofOcrTextContainsJianying("兰勇相 菜单 素材 音频 文本 贴纸"),
    true,
  );
  assert.equal(ownershipProjectProofOcrTextContainsJianying("开启创作"), false);
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

test("treats valid screenshots without 剪映 OCR text as 剧创 and rejects non-screenshots", async () => {
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

    assert.equal(await classifyOwnershipProjectProof(darkScreenshot), "juchuang");
    assert.equal(await classifyOwnershipProjectProof(lightScreenshot), "juchuang");
    assert.equal(await classifyOwnershipProjectProof(portraitLikeImage), "unknown");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "classifies the live 剪映 and 剧创 screenshots from pixels after removing filename hints",
  { skip: !existsSync(liveOwnershipProofDirectory) },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ownership-project-proof-live-"));
    const fixtures = [
      ...Array.from({ length: 10 }, (_, index) => ({
        expected: "jianying" as const,
        source: path.join(liveOwnershipProofDirectory, `剪映${index + 1}.png`),
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        expected: "juchuang" as const,
        source: path.join(liveOwnershipProofDirectory, `剧创${index + 1}.png`),
      })),
    ];

    try {
      for (const [index, fixture] of fixtures.entries()) {
        const neutralFile = path.join(root, `截图-${index + 1}.png`);
        await copyFile(fixture.source, neutralFile);
        assert.equal(
          await classifyOwnershipProjectProof(neutralFile, path.basename(neutralFile)),
          fixture.expected,
          fixture.source,
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

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

test("stops classifying screenshots after both required proof sources are satisfied", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ownership-project-proof-early-stop-"));
  const resourceName = "测试剧";
  const ownershipDir = path.join(root, resourceName, "权属文件");
  const jianyingDir = path.join(ownershipDir, "剪映");
  const juchuangDir = path.join(ownershipDir, "剧创");
  await Promise.all([
    mkdir(jianyingDir, { recursive: true }),
    mkdir(juchuangDir, { recursive: true }),
  ]);
  const fixtures = [
    { directory: jianyingDir, index: 1 },
    { directory: juchuangDir, index: 2 },
    { directory: jianyingDir, index: 3 },
    { directory: juchuangDir, index: 4 },
    { directory: ownershipDir, index: 5 },
  ];

  try {
    await Promise.all(fixtures.map(({ directory, index }) =>
      sharp({
        create: {
          width: 1_920,
          height: 1_080,
          channels: 3,
          background: { r: index * 20, g: index * 20, b: index * 20 },
        },
      }).png().toFile(path.join(directory, `${resourceName} - 权属工程文件${index}.png`))
    ));
    const progress: number[] = [];
    const selection = await findOwnershipProjectProofFiles({
      root,
      resourceName,
      onClassificationProgress: ({ completed }) => progress.push(completed),
    });

    assert.deepEqual(progress, [1, 2, 3, 4]);
    assert.deepEqual(selection.jianying.map((item) => item.index), [1, 3]);
    assert.deepEqual(selection.juchuang.map((item) => item.index), [2, 4]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
