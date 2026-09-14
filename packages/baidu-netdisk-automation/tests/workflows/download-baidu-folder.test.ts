import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";

import {
  baiduShareFailureText,
  classifyBaiduNetdiskOwnershipProofName,
  compareRemoteVideoDirectoryCandidates,
  inspectContiguousEpisodeIndexes,
  isAutomationTemporaryTransferPath,
  isBaiduNetdiskIncompleteProgressDirectoryName,
  isBaiduNetdiskOwnershipProofDirectoryName,
  isBaiduNetdiskScreenshotCandidateDirectory,
  isGenericBaiduNetdiskMaterialDirectoryName,
  isSupportedEpisodeVideoFileName,
  type RemoteVideoDirectoryCandidateScore,
} from "../../src/workflows/download-baidu-folder.js";

test("recognizes deleted and expired Baidu share pages before waiting for a file list", () => {
  assert.equal(
    baiduShareFailureText("啊哦，你来晚了，分享的文件已经被删除了，下次要早点哟。"),
    "分享的文件已经被删除",
  );
  assert.equal(
    baiduShareFailureText("啊哦，来晚了，该分享文件已过期"),
    "分享文件已过期",
  );
  assert.equal(baiduShareFailureText("全部文件 正在加载"), "");
});

test("recognizes labeled ownership screenshots from Baidu filenames", () => {
  assert.equal(classifyBaiduNetdiskOwnershipProofName("权属/剪映.png"), "jianying");
  assert.equal(classifyBaiduNetdiskOwnershipProofName("权属/剪映 1.PNG"), "jianying");
  assert.equal(classifyBaiduNetdiskOwnershipProofName("权属/剧创2.png"), "juchuang");
  assert.equal(classifyBaiduNetdiskOwnershipProofName("权属/剪映和剧创/工程1.png"), undefined);
  assert.equal(classifyBaiduNetdiskOwnershipProofName("权属/权属工程文件1.png"), undefined);
});

test("discovers proof screenshots in separately named creation-record directories", () => {
  for (const name of ["工程文件", "剪映", "剧创", "AI生成记录", "AI 创作过程"]) {
    assert.equal(isBaiduNetdiskOwnershipProofDirectoryName(name), true, name);
  }
  assert.equal(isBaiduNetdiskOwnershipProofDirectoryName("封面"), false);
});

test("discovers screenshot directories by structure even when names are arbitrary", () => {
  const images = [
    { name: "a.png", isDirectory: false },
    { name: "b.JPG", isDirectory: false },
  ];
  assert.equal(isBaiduNetdiskScreenshotCandidateDirectory(images, 1), true);
  assert.equal(isBaiduNetdiskScreenshotCandidateDirectory(images, 0), false);
  assert.equal(isBaiduNetdiskScreenshotCandidateDirectory([
    ...images, { name: "第1集.mp4", isDirectory: false },
  ], 1), false);
  assert.equal(isBaiduNetdiskScreenshotCandidateDirectory([
    ...images, { name: "子目录", isDirectory: true },
  ], 1), false);
});

test("browser-injected Baidu helpers run after serialization without module scope", () => {
  const isolate = <T>(helper: T): T => runInNewContext(`(${String(helper)})`) as T;
  const images = [
    { name: "a.png", isDirectory: false },
    { name: "b.jpg", isDirectory: false },
  ];

  assert.equal(isolate(isSupportedEpisodeVideoFileName)("第1集.mp4"), true);
  assert.equal(isolate(isBaiduNetdiskIncompleteProgressDirectoryName)("剧名-60%"), true);
  assert.equal(isolate(isGenericBaiduNetdiskMaterialDirectoryName)("1.成片"), true);
  assert.equal(isolate(classifyBaiduNetdiskOwnershipProofName)("剪映.png"), "jianying");
  assert.equal(isolate(isBaiduNetdiskOwnershipProofDirectoryName)("工程文件"), true);
  const isolatedDetector = isolate(isBaiduNetdiskScreenshotCandidateDirectory);
  assert.equal(isolatedDetector(images, 1), true);
  assert.equal(isolatedDetector([...images, { name: "第1集.mp4", isDirectory: false }], 1), false);
  const score = videoDirectoryCandidate({});
  assert.equal(isolate(compareRemoteVideoDirectoryCandidates)(score, score), 0);
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

test("recognizes numbered generic material directories instead of treating them as drama names", () => {
  assert.equal(isGenericBaiduNetdiskMaterialDirectoryName("成片"), true);
  assert.equal(isGenericBaiduNetdiskMaterialDirectoryName("1.成片"), true);
  assert.equal(isGenericBaiduNetdiskMaterialDirectoryName("01-正片"), true);
  assert.equal(isGenericBaiduNetdiskMaterialDirectoryName("2_ 视频"), true);
  assert.equal(isGenericBaiduNetdiskMaterialDirectoryName("(3)权属文件"), true);
  assert.equal(isGenericBaiduNetdiskMaterialDirectoryName("AI生成记录"), true);
  assert.equal(isGenericBaiduNetdiskMaterialDirectoryName("2.剧创"), true);
  assert.equal(isGenericBaiduNetdiskMaterialDirectoryName("来福的呼唤"), false);
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

test("prefers the directory with the most episodes over a one-episode valid sequence", () => {
  const candidates = [
    videoDirectoryCandidate({
      validEpisodeSequence: true,
      uniqueEpisodeCount: 1,
      recognizedVideoCount: 1,
      mp4Count: 1,
      path: "/山风吹醒少年心/第1集30秒",
    }),
    videoDirectoryCandidate({
      validEpisodeSequence: false,
      uniqueEpisodeCount: 41,
      recognizedVideoCount: 41,
      mp4Count: 41,
      path: "/山风吹醒少年心/胖子有字",
    }),
  ];

  candidates.sort(compareRemoteVideoDirectoryCandidates);
  assert.equal(candidates[0]?.path, "/山风吹醒少年心/胖子有字");
});
