import assert from "node:assert/strict";
import test from "node:test";

import { fileInputUploadBatches } from "../../src/automation/steps/form-controls.js";

test("keeps episode files in one batch for a multiple file input", () => {
  assert.deepEqual(fileInputUploadBatches(["1.mp4", "2.mp4"], true), [
    ["1.mp4", "2.mp4"],
  ]);
});

test("splits episode files for a single file input", () => {
  assert.deepEqual(fileInputUploadBatches(["1.mp4", "2.mp4"], false), [
    ["1.mp4"],
    ["2.mp4"],
  ]);
});
