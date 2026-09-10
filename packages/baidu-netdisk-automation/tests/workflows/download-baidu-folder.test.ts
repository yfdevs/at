import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyBaiduNetdiskOwnershipProofName,
  compareRemoteVideoDirectoryCandidates,
  inspectContiguousEpisodeIndexes,
  isAutomationTemporaryTransferPath,
  isBaiduNetdiskIncompleteProgressDirectoryName,
  isSupportedEpisodeVideoFileName,
  type RemoteVideoDirectoryCandidateScore,
} from "../../src/workflows/download-baidu-folder.js";

test("recognizes labeled ownership screenshots from Baidu filenames", () => {
  assert.equal(classifyBaiduNetdiskOwnershipProofName("权属/剪映.png"), "jianying");
  assert.equal(classifyBaiduNetdiskOwnershipProofName("权属/剪映 1.PNG"), "jianying");
  assert.equal(classifyBaiduNetdiskOwnershipProofName("权属/剧创2.png"), "juchuang");
  assert.equal(classifyBaiduNetdiskOwnershipProofName("权属/权属工程文件1.png"), undefined);
});

test("only accepts root-level timestamped automation transfer directories", () => {
  const createdAt = Date.parse("2026-09-05T06:31:54.375Z");
  assert.equal(
    isAutomationTemporaryTransferPath("/九千罚单__ewfjCNKLmw__mto096h3", createdAt),
    true,
  );
  assert.equal(isAutomationTemporaryTransferPath("/九千罚单", createdAt), false);
  assert.equal(
    isAutomationTemporaryTransferPath("/用户目录/九千罚单__ewfjCNKLmw__mto096h3", createdAt),
    false,
  );
  assert.equal(
    isAutomationTemporaryTransferPath("/九千罚单__ewfjCNKLmw__not-time", createdAt),
    false,
  );
});

test("recognizes MP4 and MOV episode video suffixes case-insensitively", () => {
  assert.equal(isSupportedEpisodeVideoFileName("第1集.mp4"), true);
  assert.equal(isSupportedEpisodeVideoFileName("第2集.MOV"), true);
  assert.equal(isSupportedEpisodeVideoFileName("第3集.avi"), false);
});

test("excludes directories containing an incomplete percentage from remote resource scans", () => {
  assert.equal(isBaiduNetdiskIncompleteProgressDirectoryName("劫骨燃尽渡苍生-60%"), true);
  assert.equal(isBaiduNetdiskIncompleteProgressDirectoryName("劫骨燃尽渡苍生（60％）"), true);
  assert.equal(isBaiduNetdiskIncompleteProgressDirectoryName("剧名_99.5%"), true);
  assert.equal(isBaiduNetdiskIncompleteProgressDirectoryName("成片"), false);
  assert.equal(isBaiduNetdiskIncompleteProgressDirectoryName("100%完成"), false);
  assert.equal(isBaiduNetdiskIncompleteProgressDirectoryName("剧名-100%"), false);
  assert.equal(isBaiduNetdiskIncompleteProgressDirectoryName("剧名-60%修复版"), true);
});

function videoDirectoryCandidate(
  overrides: Partial<RemoteVideoDirectoryCandidateScore>,
): RemoteVideoDirectoryCandidateScore {
  return {
    validEpisodeSequence: true,
    materialDirectory: false,
    preferredEpisodeDirectory: false,
    uniqueEpisodeCount: 8,
    recognizedVideoCount: 8,
    mp4Count: 8,
    depth: 1,
    path: "/剧名",
    ...overrides,
  };
}

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

test("prefers a valid episode directory over a material directory with more mp4 clips", () => {
  const candidates = [
    videoDirectoryCandidate({
      validEpisodeSequence: false,
      materialDirectory: true,
      uniqueEpisodeCount: 8,
      recognizedVideoCount: 347,
      mp4Count: 347,
      path: "/九千罚单/素材",
    }),
    videoDirectoryCandidate({
      preferredEpisodeDirectory: true,
      path: "/九千罚单/成片",
    }),
  ];

  candidates.sort(compareRemoteVideoDirectoryCandidates);
  assert.equal(candidates[0]?.path, "/九千罚单/成片");
});

test("prefers a clean neutral episode directory over a numbered material directory", () => {
  const candidates = [
    videoDirectoryCandidate({
      materialDirectory: true,
      uniqueEpisodeCount: 80,
      recognizedVideoCount: 80,
      mp4Count: 80,
      path: "/九千罚单/素材",
    }),
    videoDirectoryCandidate({ path: "/九千罚单" }),
  ];

  candidates.sort(compareRemoteVideoDirectoryCandidates);
  assert.equal(candidates[0]?.path, "/九千罚单");
});
