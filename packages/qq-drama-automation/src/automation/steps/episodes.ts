import type { Page } from "playwright";
import {
  cleanupEpisodeUploadFiles,
  prepareEpisodeUploadFiles,
  type PreparedEpisodeUploadFiles,
} from "@drama/drama-media-assets";
import { log } from "../../shared/logger.js";
import {
  getQqDramaLocalEpisodeVideoRoot,
  getQqDramaOriginalTitle,
  validateQqDramaLocalEpisodeVideos,
} from "../../shared/local-episode-videos.js";
import type { ClaimedQqDramaTask, QqDramaRuntimeOptions } from "../../shared/types.js";
import { clickNextStep, uploadLocalFilesByTarget } from "./form-controls.js";
import { taskTitle } from "./payload.js";

type EpisodeUploadStatus = {
  status: "failed" | "processing" | "succeeded" | "waiting";
  text: string;
  failedText?: string;
};

async function readEpisodeUploadStatus(page: Page, episodeCount: number): Promise<EpisodeUploadStatus> {
  return page.evaluate((expectedCount): EpisodeUploadStatus => {
    const normalize = (value: string | null | undefined) =>
      value?.replace(/\s+/g, " ").trim() ?? "";
    const uploadHeader = document.querySelector<HTMLElement>(".upload-header-left");
    const root = uploadHeader ?? document.body;
    const text = normalize(root.textContent);
    const failedText = normalize(root.querySelector<HTMLElement>(".stat-error")?.textContent);
    const hasFailure =
      Boolean(failedText) || /(?:\d+\s*集)?失败|上传失败|未能上传|上传异常/.test(text);

    if (hasFailure) {
      return {
        status: "failed",
        text,
        failedText,
      };
    }

    const completedMatch = text.match(/(\d+)\s*\/\s*(\d+)\s*集已完成/);
    const completedCount = Number(completedMatch?.[1] ?? -1);
    const totalCount = Number(completedMatch?.[2] ?? -1);
    const hasSuccess =
      (completedCount === expectedCount && totalCount === expectedCount) ||
      text.includes(`全部 ${expectedCount} 集上传完成`);

    if (hasSuccess) {
      return {
        status: "succeeded",
        text,
      };
    }

    if (/处理中|上传中|等待上传|进度\s*\d+\s*\/\s*\d+\s*集/.test(text)) {
      return {
        status: "processing",
        text,
      };
    }

    return {
      status: "waiting",
      text,
    };
  }, episodeCount);
}

async function waitForEpisodeUploadComplete(
  page: Page,
  episodeCount: number,
  options: QqDramaRuntimeOptions,
) {
  const timeoutMs = 80 * 60 * 1000;
  const pollMs = 2_000;
  const startedAt = Date.now();
  let lastText = "";

  while (Date.now() - startedAt < timeoutMs) {
    const result = await readEpisodeUploadStatus(page, episodeCount);
    if (result.text && result.text !== lastText) {
      lastText = result.text;
      log(options, `[qq-drama] episode upload status: ${result.text}`);
    }

    if (result.status === "failed") {
      throw new Error(`[upload-failed] 剧集视频上传失败：${result.failedText || result.text}`);
    }

    if (result.status === "succeeded") {
      return;
    }

    await page.waitForTimeout(pollMs);
  }

  throw new Error(
    `[upload-failed] 等待 QQ 剧集视频上传完成超时。当前状态：${lastText || "未读取到上传状态"}`,
  );
}

async function uploadEpisodeVideosIfPresent(
  page: Page,
  task: ClaimedQqDramaTask,
  options: QqDramaRuntimeOptions,
): Promise<PreparedEpisodeUploadFiles | null> {
  // 没有集数说明这个任务不需要上传正片视频，直接跳过剧集上传步骤。
  const episodeCount = task.playlet.episodeCount;
  if (!episodeCount) return null;
  // oxlint-disable-next-line no-debugger
  debugger;

  // 剧集上传依赖本地视频根目录和临时上传目录，缺任意一个都无法准备文件。
  const localEpisodeVideoRoot = getQqDramaLocalEpisodeVideoRoot(options);
  if (!options.assetDownloadDir) {
    throw new Error("请先配置 QQ 短剧素材下载目录。");
  }

  const resourceName = getQqDramaOriginalTitle(task);
  // 先校验本地目录中是否刚好存在第 1 集到第 N 集，避免页面上传到一半才失败。
  await validateQqDramaLocalEpisodeVideos(task, options);

  // 为 Playwright 文件上传准备临时文件名；共享包会创建硬链接，外层 finally 负责清理。
  const prepared = await prepareEpisodeUploadFiles({
    localEpisodeVideoRoot,
    resourceName,
    uploadRootDir: options.assetDownloadDir,
    uploadBaseName: taskTitle(task.playlet),
  });

  // 双重确认准备出来的上传文件数量，防止校验后目录内容发生变化。
  if (prepared.files.length !== episodeCount) {
    throw new Error(
      `[upload-failed] 剧集视频: expected ${episodeCount} local video file(s), got ${prepared.files.length}.`,
    );
  }

  await uploadLocalFilesByTarget(page, {
    files: prepared.files,
  });
  await waitForEpisodeUploadComplete(page, episodeCount, options);
  return prepared;
}

export async function uploadEpisodeVideosStep(
  page: Page,
  task: ClaimedQqDramaTask,
  options: QqDramaRuntimeOptions,
) {
  let preparedEpisodes: PreparedEpisodeUploadFiles | null = null;
  try {
    preparedEpisodes = await uploadEpisodeVideosIfPresent(page, task, options);

    if (task.playlet.submit) {
      await clickNextStep(page, options);
    }
  } finally {
    if (preparedEpisodes) {
      await cleanupEpisodeUploadFiles(preparedEpisodes);
    }
  }
}
