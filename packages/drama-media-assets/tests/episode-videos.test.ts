import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  cleanupEpisodeUploadFiles,
  findEpisodeMinimumDurationViolations,
  findLocalEpisodeVideos,
  prepareEpisodeUploadFiles,
} from "../src/index.js";

test("treats episode durations at or below the configured minimum as invalid", () => {
  const episodes = [
    { index: 1, file: "1.mp4", durationSeconds: 179.99 },
    { index: 2, file: "2.mp4", durationSeconds: 180 },
    { index: 3, file: "3.mp4", durationSeconds: 180.01 },
  ];

  assert.deepEqual(
    findEpisodeMinimumDurationViolations(episodes, 180).map((episode) => episode.index),
    [1, 2],
  );
});

test("finds MP4 and MOV episodes and preserves their suffixes for upload", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "drama-episode-videos-"));
  const resourceName = "MOV识别测试剧";
  const episodeDir = path.join(root, resourceName, "成片");
  const uploadRootDir = path.join(root, "uploads");

  try {
    await mkdir(episodeDir, { recursive: true });
    await writeFile(path.join(episodeDir, `${resourceName}-第1集.mp4`), "episode-1");
    await writeFile(path.join(episodeDir, `${resourceName}-第2集.MOV`), "episode-2");
    await writeFile(path.join(episodeDir, `${resourceName}-第3集.avi`), "unsupported");

    const episodes = await findLocalEpisodeVideos({ localEpisodeVideoRoot: root, resourceName });
    assert.deepEqual(episodes.map((episode) => episode.index), [1, 2]);
    assert.deepEqual(episodes.map((episode) => path.extname(episode.file).toLowerCase()), [".mp4", ".mov"]);

    const prepared = await prepareEpisodeUploadFiles({
      localEpisodeVideoRoot: root,
      resourceName,
      uploadRootDir,
      uploadBaseName: "上传剧名",
      episodes,
    });
    try {
      assert.deepEqual(prepared.files.map((file) => path.basename(file)), [
        "上传剧名-第1集.mp4",
        "上传剧名-第2集.mov",
      ]);
    } finally {
      await cleanupEpisodeUploadFiles(prepared);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
