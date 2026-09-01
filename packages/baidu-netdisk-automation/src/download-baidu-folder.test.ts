import assert from "node:assert/strict";
import test from "node:test";

import { inspectContiguousEpisodeIndexes } from "./download-baidu-folder.js";

test("infers the highest continuous episode as total count", () => {
  assert.deepEqual(inspectContiguousEpisodeIndexes([3, 1, 2]), {
    episodeCount: 3,
    indexes: [1, 2, 3],
    missingIndexes: [],
    duplicateIndexes: [],
    valid: true,
  });
});

test("rejects a missing middle episode", () => {
  const result = inspectContiguousEpisodeIndexes([1, 2, 4]);
  assert.equal(result.episodeCount, 4);
  assert.deepEqual(result.missingIndexes, [3]);
  assert.equal(result.valid, false);
});

test("requires the sequence to start at episode one", () => {
  const result = inspectContiguousEpisodeIndexes([2, 3, 4]);
  assert.deepEqual(result.missingIndexes, [1]);
  assert.equal(result.valid, false);
});

test("rejects duplicate episode indexes", () => {
  const result = inspectContiguousEpisodeIndexes([1, 2, 3], [2]);
  assert.deepEqual(result.duplicateIndexes, [2]);
  assert.equal(result.valid, false);
});

test("rejects a listing without recognizable episode indexes", () => {
  const result = inspectContiguousEpisodeIndexes([]);
  assert.equal(result.episodeCount, 0);
  assert.equal(result.valid, false);
});
