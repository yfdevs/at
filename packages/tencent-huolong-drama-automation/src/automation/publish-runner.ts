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
    while (Date.now() - startedAt < timeoutMs) {
      const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      if (
        /全部.*上传完成|上传完成|上传成功|已完成/.test(bodyText)
        && !/上传中|处理中|封面图生成中/.test(bodyText)
      ) return;
      if (/上传失败|重新上传/.test(bodyText)) throw new Error("TENCENT_HUOLONG_DRAMA_EPISODE_UPLOAD_FAILED");
      await page.waitForTimeout(2_000);
    }
    throw new Error("TENCENT_HUOLONG_DRAMA_EPISODE_UPLOAD_TIMEOUT");
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
