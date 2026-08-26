import path from "node:path";
import { rm } from "node:fs/promises";
import {
  listLocalPosterImages,
  prepareImageForUpload,
} from "@drama/drama-media-assets";
import { log } from "./logger.js";
import type { ClaimedQqDramaTask, QqDramaRuntimeOptions } from "./types.js";
import {
  getQqDramaLocalEpisodeVideoRoot,
  getQqDramaOriginalTitle,
} from "./local-episode-videos.js";

export async function prepareQqDramaPosterMaterial(
  task: ClaimedQqDramaTask,
  options: QqDramaRuntimeOptions,
) {
  const localEpisodeVideoRoot = getQqDramaLocalEpisodeVideoRoot(options);
  const resourceName = getQqDramaOriginalTitle(task);
  const files = await listLocalPosterImages({
    root: localEpisodeVideoRoot,
    resourceName,
  });
  if (files.length < 1) {
    throw new Error(
      `[poster-material-invalid] 未找到文件名或目录名包含“封面”或“海报”的图片；` +
      `扫描目录=${localEpisodeVideoRoot}`,
    );
  }

  const selected = files[0];
  if (!options.assetDownloadDir) {
    throw new Error("QQ drama assetDownloadDir is required to prepare the cover image.");
  }
  const outputDir = path.join(options.assetDownloadDir, "poster-upload");
  await rm(outputDir, { recursive: true, force: true });
  const prepared = await prepareImageForUpload({
    inputFile: selected.file,
    outputDir,
    outputFileName: "qq-cover.jpg",
    policy: {
      maxFileBytes: 5_000_000,
      targetFileBytes: 4_700_000,
      minimumWidth: 350,
      minimumHeight: 500,
      maximumWidth: 2_100,
      maximumHeight: 3_000,
      minimumJpegQuality: 80,
      targetAspectRatio: { width: 7, height: 10, tolerance: 0.02 },
    },
    onLog: (message) => log(options, `[qq-drama] ${message}`),
  });
  task.playlet.localCoverFile = prepared.file;
  return {
    ...selected,
    file: prepared.file,
    size: prepared.outputSize,
  };
}
