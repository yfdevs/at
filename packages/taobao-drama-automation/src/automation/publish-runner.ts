import type { BrowserContext, Page } from "playwright";
import { isNonRetryableBaiduNetdiskResourceError } from "@drama/drama-media-assets";
import { taobaoMaterialRoot, validateTaobaoEpisodeVideos } from "../shared/local-materials.js";
import { log } from "../shared/logger.js";
import type { TaobaoBatchUploadTask, TaobaoDramaRuntimeOptions } from "../shared/types.js";
import { saveTaobaoCredentialState, waitForTaobaoPage } from "./browser-session.js";
import { uploadAndPublishTaobaoEpisodes } from "./episodes.js";
import { prepareTaobaoEpisodeMetadata } from "../shared/episode-metadata.js";

export function taobaoBaiduResourceRequest(
  task: TaobaoBatchUploadTask,
  options: TaobaoDramaRuntimeOptions,
) {
  return {
    shareText: task.baiduPanResourceLink,
    resourceName: task.originalTitle,
    localEpisodeVideoRoot: taobaoMaterialRoot(options),
    episodeCount: task.episodeCount,
    requiredPosterImages: 0,
    // Taobao batch publishing only uploads episode videos. Synopsis files are optional:
    // metadata generation already falls back to the drama title when none exist locally.
    downloadAssetMaterials: false,
    forceAssetDownload: false,
    requireAllDiscoveredAssets: false,
    requiredMetadataTextFiles: 0,
  };
}

async function ensureResource(
  task: TaobaoBatchUploadTask,
  options: TaobaoDramaRuntimeOptions,
) {
  if (!options.ensureBaiduNetdiskResource) {
    throw new Error("淘宝短剧运行时未接入百度网盘下载能力。");
  }
  const retries = Math.max(0, options.baiduNetdiskDownloadRetryAttempts ?? 3);
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await options.ensureBaiduNetdiskResource(taobaoBaiduResourceRequest(task, options));
      return;
    } catch (error) {
      lastError = error;
      if (isNonRetryableBaiduNetdiskResourceError(error) || attempt >= retries) break;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
  throw lastError;
}

export async function runTaobaoPublishTask(
  page: Page,
  context: BrowserContext,
  task: TaobaoBatchUploadTask,
  options: TaobaoDramaRuntimeOptions,
) {
  log(options, `[taobao-drama] 开始批量上传：${task.originalTitle}`);
  // Navigate immediately so a task never presents an about:blank window while a
  // lengthy Baidu download or local resource check is running.
  await waitForTaobaoPage(page, "batch", options);
  await saveTaobaoCredentialState(context, options);
  await options.updateTaskProgress?.(task.id, "downloading");
  await ensureResource(task, options);
  await validateTaobaoEpisodeVideos(task, options);
  const metadata = await prepareTaobaoEpisodeMetadata(task, options);

  await options.updateTaskProgress?.(task.id, "uploading");
  await waitForTaobaoPage(page, "batch", options);
  await saveTaobaoCredentialState(context, options);
  await uploadAndPublishTaobaoEpisodes(page, task, metadata, options);
  log(options, `[taobao-drama] ${task.originalTitle} 的 ${task.episodeCount} 集批量发布完成`);
}
