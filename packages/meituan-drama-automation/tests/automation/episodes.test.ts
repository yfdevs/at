import assert from "node:assert/strict";
import test from "node:test";

import { episodeInputFileBatches } from "../../src/automation/steps/episodes.js";

test("keeps a Meituan episode selection together when the input supports multiple files", () => {
  assert.deepEqual(episodeInputFileBatches(["1.mp4", "2.mp4"], true), [
    ["1.mp4", "2.mp4"],
  ]);
});

test("queues Meituan episodes one by one when the follow-up input is single-file", () => {
  assert.deepEqual(episodeInputFileBatches(["101.mp4", "102.mp4"], false), [
    ["101.mp4"],
    ["102.mp4"],
  ]);
});
