import assert from "node:assert/strict";
import test from "node:test";

import {
  fileInputUploadBatches,
  isQqEpisodeVideoInputCandidate,
} from "../../src/automation/steps/form-controls.js";

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

test("excludes the optional highlight-video input from episode uploads", () => {
  assert.equal(isQqEpisodeVideoInputCandidate({
    accept: "video/*",
    multiple: false,
    sectionText: "高光视频 选填",
    insideHighlightCard: true,
  }), false);
  assert.equal(isQqEpisodeVideoInputCandidate({
    accept: "video/*",
    multiple: true,
    sectionText: "",
    insideHighlightCard: false,
  }), true);
});
