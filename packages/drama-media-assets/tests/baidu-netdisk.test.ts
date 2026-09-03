import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ensureBaiduNetdiskEpisodeVideos,
  resolveBaiduNetdiskAssetCompletionRequirements,
} from "../src/baidu-netdisk.js";
import { isOwnershipDirectoryName, listLocalOwnershipMaterials } from "../src/index.js";

test("optional remotely discovered ownership does not block a poster-only platform", () => {
  assert.deepEqual(
    resolveBaiduNetdiskAssetCompletionRequirements({
      requiredOwnershipImages: 0,
      requiredOwnershipFiles: 0,
      requiredPosterImages: 1,
      discoveredOwnershipImages: 13,
      discoveredOwnershipFiles: 13,
      discoveredPosterImages: 1,
    }),
    {
      ownershipImages: 0,
      ownershipFiles: 0,
      posterImages: 1,
      aiProductionProofFiles: 0,
    },
  );
});

test("explicit ownership requirements remain blocking", () => {
  assert.deepEqual(
    resolveBaiduNetdiskAssetCompletionRequirements({
      requiredOwnershipImages: 13,
      requiredOwnershipFiles: 13,
      discoveredOwnershipImages: 13,
      discoveredOwnershipFiles: 13,
    }),
    {
      ownershipImages: 13,
      ownershipFiles: 13,
      posterImages: 0,
      aiProductionProofFiles: 0,
    },
  );
});

test("strict mode waits for every remotely discovered optional asset", () => {
  assert.deepEqual(
    resolveBaiduNetdiskAssetCompletionRequirements({
      requiredOwnershipImages: 0,
      requiredOwnershipFiles: 0,
      discoveredOwnershipImages: 13,
      discoveredOwnershipFiles: 13,
      requireAllDiscoveredAssets: true,
    }),
    {
      ownershipImages: 13,
      ownershipFiles: 13,
      posterImages: 0,
      aiProductionProofFiles: 0,
    },
  );
});

test("local ownership directory recognition matches the remote scanner", () => {
  for (const name of ["工程文件", "权属", "主体资质", "版权证明", " 版 权 资料 "]) {
    assert.equal(isOwnershipDirectoryName(name), true, name);
  }
  assert.equal(isOwnershipDirectoryName("海报封面"), false);
});

test("ownership images under qualification and copyright directories are scanned", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "drama-ownership-scan-"));
  const resourceName = "测试短剧";
  try {
    for (const [index, directory] of ["主体资质", "版权证明"].entries()) {
      const target = path.join(root, resourceName, directory);
      await mkdir(target, { recursive: true });
      await writeFile(path.join(target, `${directory}.jpg`), Buffer.from([index + 1]));
    }

    const materials = await listLocalOwnershipMaterials({ root, resourceName });
    assert.equal(materials.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resource readiness returns when only unrequested remote ownership is incomplete", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "drama-baidu-ready-"));
  const resourceName = "鑫沐痴心";
  try {
    const result = await ensureBaiduNetdiskEpisodeVideos({
      shareText: "https://pan.baidu.com/s/test?pwd=test",
      resourceName,
      localEpisodeVideoRoot: root,
      episodeCount: 0,
      downloadEpisodeVideos: false,
      forceAssetDownload: true,
      requiredPosterImages: 0,
      timeoutMs: 100,
      pollIntervalMs: 1,
      stableCompletePolls: 1,
      downloadShare: async () => ({
        share: { link: "https://pan.baidu.com/s/test", pwd: "test", name: resourceName },
        localPath: path.join(root, "temporary-download", resourceName),
        expectedOwnershipImages: 13,
        expectedOwnershipFiles: 13,
        completed: false,
        skippedExisting: false,
      }),
    });

    assert.equal(result.completed, true);
    assert.equal(result.localPath, path.join(root, resourceName));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
