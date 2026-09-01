// oxlint-disable typescript/no-floating-promises
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";

import {
  claimNextIqiyiDramaTaskApi,
  createMockIqiyiDramaTask,
  resetMockIqiyiDramaTaskApiForTesting,
} from "./task.js";

test("provides real local production and copyright proof files in the mock task", () => {
  const task = createMockIqiyiDramaTask();
  const { productionProofFiles, licenseProofFiles } = task.playlet.copyright;

  assert.equal(productionProofFiles.length, 1);
  assert.equal(licenseProofFiles.length, 1);
  assert.ok(productionProofFiles.every(existsSync));
  assert.ok(licenseProofFiles.every(existsSync));
  assert.match(productionProofFiles[0], /模拟爱奇艺短剧制作合同\.jpg$/u);
  assert.match(licenseProofFiles[0], /模拟爱奇艺版权证明\.jpg$/u);
});

test("claims a mock task only after all built-in proof assets are available", async () => {
  resetMockIqiyiDramaTaskApiForTesting();
  const task = await claimNextIqiyiDramaTaskApi({});
  assert.ok(task);
  assert.ok(task.playlet.copyright.productionProofFiles.every(existsSync));
  assert.ok(task.playlet.copyright.licenseProofFiles.every(existsSync));
});
