import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";

import {
  baiduShareFailureText,
  classifyBaiduNetdiskOwnershipProofName,
  collapseIdenticalRemoteEpisodeAliases,
  compareRemoteVideoDirectoryCandidates,
  inspectContiguousEpisodeIndexes,
  isAutomationTemporaryTransferPath,
  isBaiduNetdiskIncompleteProgressDirectoryName,
  isBaiduNetdiskOwnershipProofDirectoryName,
  isBaiduNetdiskScreenshotCandidateDirectory,
  isGenericBaiduNetdiskMaterialDirectoryName,
  isSupportedEpisodeVideoFileName,
  validateRemoteEpisodePathSelection,
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
  assert.equal(
    isolate(collapseIdenticalRemoteEpisodeAliases)([
      { index: 1, name: "剧名-第1集.mp4", path: "/剧名-第1集.mp4", size: 100 },
      { index: 1, name: "分集-1.mp4", path: "/分集-1.mp4", size: 100 },
    ]).files.length,
    1,
  );
});

test("collapses renamed remote episode copies only when their exact sizes match", () => {
  const matching = collapseIdenticalRemoteEpisodeAliases([
    { index: 1, name: "瘸腿-分集-1.mp4", path: "/瘸腿-分集-1.mp4", size: 162_214_707 },
    { index: 1, name: "全村笑我娶瘸腿姑娘-第1集.mp4", path: "/全村笑我娶瘸腿姑娘-第1集.mp4", size: 162_214_707 },
    { index: 2, name: "瘸腿-分集-2.mp4", path: "/瘸腿-分集-2.mp4", size: 155_608_678 },
    { index: 2, name: "全村笑我娶瘸腿姑娘-第2集.mp4", path: "/全村笑我娶瘸腿姑娘-第2集.mp4", size: 155_608_678 },
  ]);

  assert.deepEqual(matching.files.map((file) => file.index), [1, 2]);
  assert.ok(matching.files.every((file) => file.name.includes("第")));
  assert.equal(matching.ignored.length, 2);

  const conflicting = collapseIdenticalRemoteEpisodeAliases([
    { index: 1, name: "版本A-1.mp4", path: "/版本A-1.mp4", size: 100 },
    { index: 1, name: "版本B-1.mp4", path: "/版本B-1.mp4", size: 101 },
  ]);
  assert.equal(conflicting.files.length, 2);
  assert.equal(conflicting.ignored.length, 0);

  const differentHashes = collapseIdenticalRemoteEpisodeAliases([
    { index: 1, name: "版本A-1.mp4", path: "/版本A-1.mp4", size: 100, contentHash: "aaa" },
    { index: 1, name: "版本B-1.mp4", path: "/版本B-1.mp4", size: 100, contentHash: "bbb" },
  ]);
  assert.equal(differentHashes.files.length, 2);
});

test("reduces two renamed 1-60 sets to one complete 60-episode set", () => {
  const candidates = Array.from({ length: 60 }, (_, position) => position + 1).flatMap((index) => [
    {
      index,
      name: `瘸腿-分集-${index}.mp4`,
      path: `/瘸腿-分集-${index}.mp4`,
      size: 100_000_000 + index,
    },
    {
      index,
      name: `全村笑我娶瘸腿姑娘-第${index}集.mp4`,
      path: `/全村笑我娶瘸腿姑娘-第${index}集.mp4`,
      size: 100_000_000 + index,
    },
  ]);
  const resolved = collapseIdenticalRemoteEpisodeAliases(candidates);
  assert.equal(resolved.files.length, 60);
  assert.deepEqual(resolved.files.map((file) => file.index), Array.from({ length: 60 }, (_, index) => index + 1));
  assert.equal(resolved.ignored.length, 60);
});

test("accepts only one complete continuous AI-selected episode set", () => {
  const candidates = [
    { index: 1, name: "A-1.mp4", path: "/A-1.mp4", size: 100 },
    { index: 1, name: "B-1.mp4", path: "/B-1.mp4", size: 101 },
    { index: 2, name: "A-2.mp4", path: "/A-2.mp4", size: 200 },
    { index: 2, name: "B-2.mp4", path: "/B-2.mp4", size: 201 },
  ];
  assert.deepEqual(
    validateRemoteEpisodePathSelection(candidates, ["/B-1.mp4", "/B-2.mp4"], 2)
      ?.map((file) => file.path),
    ["/B-1.mp4", "/B-2.mp4"],
  );
  assert.equal(
    validateRemoteEpisodePathSelection(candidates, ["/A-1.mp4", "/B-1.mp4"], 2),
    undefined,
  );
  assert.equal(
    validateRemoteEpisodePathSelection(candidates, ["/A-1.mp4"], 2),
    undefined,
  );
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
