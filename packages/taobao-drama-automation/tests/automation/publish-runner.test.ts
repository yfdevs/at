import assert from "node:assert/strict";
import test from "node:test";

import { taobaoBaiduResourceRequest } from "../../src/automation/publish-runner.js";

test("requests only episode videos from Baidu for Taobao publishing", () => {
  const request = taobaoBaiduResourceRequest({
    id: "task-1",
    originalTitle: "测试短剧",
    baiduPanResourceLink: "https://pan.baidu.com/s/example?pwd=1234",
    episodeCount: 66,
  }, {
    localMaterialRoot: "D:\\短剧素材",
  });

  assert.equal(request.downloadAssetMaterials, false);
  assert.equal(request.forceAssetDownload, false);
  assert.equal(request.requireAllDiscoveredAssets, false);
  assert.equal(request.requiredMetadataTextFiles, 0);
  assert.equal(request.requiredPosterImages, 0);
  assert.equal(request.episodeCount, 66);
});
