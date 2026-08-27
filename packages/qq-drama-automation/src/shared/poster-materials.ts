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
  const maximumFileBytes = 5_000_000;
  if (selected.size <= maximumFileBytes) {
    task.playlet.localCoverFile = selected.file;
    return selected;
  }

  if (!options.assetDownloadDir) {
    throw new Error("QQ drama assetDownloadDir is required to compress the cover image.");
  }
  const outputDir = path.join(options.assetDownloadDir, "poster-upload");
  await rm(outputDir, { recursive: true, force: true });
  const prepared = await prepareImageForUpload({
    inputFile: selected.file,
    outputDir,
    outputFileName: "qq-cover.jpg",
    policy: {
      maxFileBytes: maximumFileBytes,
      targetFileBytes: 4_700_000,
      minimumWidth: 1,
      minimumHeight: 1,
      minimumJpegQuality: 80,
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
