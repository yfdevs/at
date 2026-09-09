import type { BrowserContext, Page } from "playwright";
import {
  cleanupEpisodeUploadFiles,
  prepareEpisodeUploadFiles,
} from "@drama/drama-media-assets";
import { TENCENT_HUOLONG_DRAMA_ADD_URL } from "../shared/constants.js";
import { prepareTencentHuolongCovers } from "../shared/covers.js";
import {
  materialRoot,
  prepareTencentHuolongRequiredMaterials,
  sourcePoster,
  validateEpisodeVideos,
} from "../shared/local-materials.js";
import { log } from "../shared/logger.js";
import { resolveTencentHuolongSubtitle } from "../shared/subtitle.js";
import type { ClaimedTencentHuolongDramaTask, TencentHuolongRuntimeOptions } from "../shared/types.js";
import { saveCredentialState, waitForLoginIfNeeded } from "./browser-session.js";
import {
  fillTencentHuolongFirstPage,
  submitAndOpenVideoStep,
  submitTencentHuolongVideos,
} from "./form-controls.js";

export async function openTencentHuolongAddPage(page: Page, context: BrowserContext, options: TencentHuolongRuntimeOptions) {
  await page.goto(TENCENT_HUOLONG_DRAMA_ADD_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForLoginIfNeeded(page, context, options);
  if (page.url() !== TENCENT_HUOLONG_DRAMA_ADD_URL) {
    await page.goto(TENCENT_HUOLONG_DRAMA_ADD_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  }
  await page.locator('[data-field-name="user_title"] input').waitFor({ state: "visible", timeout: 60_000 });
}

type FailedEpisodeUpload = {
  episodeNumber: string;
  title: string;
};

type EpisodeUploadRowSnapshot = FailedEpisodeUpload & {
  statuses: string[];
};

export function findFailedEpisodeUploads(rows: EpisodeUploadRowSnapshot[]): FailedEpisodeUpload[] {
  return rows
    .filter(({ statuses }) => statuses.includes("上传失败"))
    .map(({ episodeNumber, title }) => ({ episodeNumber, title }));
}

export async function readFailedEpisodeUploads(page: Page): Promise<FailedEpisodeUpload[]> {
  const rows = await page.locator("section[data-g-index]").evaluateAll((elements) => elements.map((row) => {
    const episodeNumber = row.getAttribute("data-g-index")?.trim() ?? "未知";
    const titleInput = row.querySelector<HTMLInputElement>('[data-field-name$=".video_title"] input');
    const statuses = Array.from(row.querySelectorAll("header div, header span"))
      .map((element) => element.textContent?.trim() ?? "")
      .filter(Boolean);
    return {
      episodeNumber,
      title: titleInput?.value.trim() ?? "",
      statuses,
    };
  }));
  return findFailedEpisodeUploads(rows);
}

async function uploadEpisodeVideos(
  page: Page,
  task: ClaimedTencentHuolongDramaTask,
  options: TencentHuolongRuntimeOptions,
) {
  if (!options.assetDownloadDir) throw new Error("TENCENT_HUOLONG_DRAMA_ASSET_DIR_REQUIRED");
  await validateEpisodeVideos(task, options);
  const prepared = await prepareEpisodeUploadFiles({
    localEpisodeVideoRoot: materialRoot(options),
    resourceName: task.originalTitle,
    uploadRootDir: options.assetDownloadDir,
    uploadBaseName: task.playlet.title,
  });
  try {
    if (prepared.files.length !== task.playlet.episodeCount) {
      throw new Error(`TENCENT_HUOLONG_DRAMA_EPISODE_COUNT_MISMATCH: expected=${task.playlet.episodeCount} actual=${prepared.files.length}`);
    }
    const input = page.locator('input[type="file"][accept*="video"],input[type="file"][accept*="mp4"]').first();
    await input.setInputFiles(prepared.files, { timeout: 120_000 });
    const timeoutMs = Math.max(1, options.episodeUploadWaitTimeoutMinutes ?? 120) * 60_000;
    const startedAt = Date.now();
    const progressTitles = page.locator('header[class*="_header_"] div[class*="_title_"]').filter({ visible: true });
    let lastProgress = "";
    while (Date.now() - startedAt < timeoutMs) {
      const failedUploads = await readFailedEpisodeUploads(page);
      if (failedUploads.length > 0) {
        const failedEpisodes = failedUploads
          .map(({ episodeNumber, title }) => `视频${episodeNumber}${title ? `（${title}）` : ""}`)
          .join("、");
        throw new Error(
          `TENCENT_HUOLONG_DRAMA_EPISODE_UPLOAD_FAILED: failed=${failedEpisodes}`
          + (lastProgress ? `; progress=${lastProgress}` : ""),
        );
      }

      const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      if (/上传失败/.test(bodyText)) {
        throw new Error(`TENCENT_HUOLONG_DRAMA_EPISODE_UPLOAD_FAILED${lastProgress ? `: progress=${lastProgress}` : ""}`);
      }

      const titles = await progressTitles.allInnerTexts();
      const progressText = titles.find((text) => /(?:正在上传|上传完成).*?[（(]\s*\d+\s*\/\s*\d+\s*[)）]/u.test(text));
      const match = progressText?.match(/[（(]\s*(\d+)\s*\/\s*(\d+)\s*[)）]/u);
      if (match) {
        const completed = Number(match[1]);
        const total = Number(match[2]);
        const progress = `${completed}/${total}`;
        if (progress !== lastProgress) {
          log(options, `[tencent-huolong-drama] 剧集视频上传进度：${progress}`);
          lastProgress = progress;
        }
        if (completed >= prepared.files.length && total === prepared.files.length) {
          log(options, `[tencent-huolong-drama] 剧集视频已全部上传完成：${progress}`);
          return;
        }
      }
      await page.waitForTimeout(1_000);
    }
    throw new Error(`TENCENT_HUOLONG_DRAMA_EPISODE_UPLOAD_TIMEOUT${lastProgress ? `: progress=${lastProgress}` : ""}`);
  } finally {
    await cleanupEpisodeUploadFiles(prepared);
  }
}

export async function runTencentHuolongPublishTask(
  page: Page,
  context: BrowserContext,
  task: ClaimedTencentHuolongDramaTask,
  options: TencentHuolongRuntimeOptions,
) {
  await openTencentHuolongAddPage(page, context, options);
  await prepareTencentHuolongRequiredMaterials(task, options);
  const poster = await sourcePoster(task, options);
  const subtitle = await resolveTencentHuolongSubtitle(task.playlet, options);
  const covers = await prepareTencentHuolongCovers(poster, task, options);
  await fillTencentHuolongFirstPage(page, task, subtitle, covers, options);
  await submitAndOpenVideoStep(page, options);
  await uploadEpisodeVideos(page, task, options);
  await submitTencentHuolongVideos(page, options);
  await saveCredentialState(context, options).catch(() => undefined);
  log(options, `[tencent-huolong-drama] 视频已添加并提交：${task.playlet.episodeCount} 集`);
}
