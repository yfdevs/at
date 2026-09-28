import assert from "node:assert/strict";
import test from "node:test";

import { iqiyiBaiduMaterialRequirements } from "../../src/app/runtime.js";

test("does not require Baidu ownership materials before iQiyi review submission", () => {
  assert.deepEqual(iqiyiBaiduMaterialRequirements(), {
    forceAssetDownload: true,
    requiredOwnership: { minimumImages: 0 },
    requiredOwnershipFiles: 0,
    requiredPosterImages: 1,
    requireAllDiscoveredAssets: false,
  });
});
