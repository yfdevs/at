import path from "node:path";
import type { Locator, Page } from "playwright";
import { TAOBAO_DRAMA_MIN_SETTLE_MS } from "../shared/constants.js";
import { findTaobaoEpisodeVideos, validateTaobaoEpisodeVideos } from "../shared/local-materials.js";
import { log } from "../shared/logger.js";
import type { ClaimedTaobaoDramaTask, TaobaoDramaRuntimeOptions } from "../shared/types.js";
import { isTaobaoCreatorSuccessNavigation } from "./browser-session.js";
import { summarizeTaobaoUploadText } from "./form-controls.js";

const maxFilesPerSelection = 50;

export function isTaobaoVideoInputCandidate(attributes: {
  accept: string;
  multiple: boolean;
  nearby: string;
}) {
  const explicitVideo = /video|mp4/i.test(attributes.accept) ||
    /上传视频|添加视频|上传剧集/.test(attributes.nearby);
  const untypedBatchVideo = !attributes.accept && attributes.multiple && /视频|剧集/.test(attributes.nearby);
  return explicitVideo || untypedBatchVideo;
}

async function videoInput(page: Page): Promise<Locator> {
  const inputs = page.locator("input[type='file']:not([disabled])");
  const count = await inputs.count();
  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index);
    const attributes = await input.evaluate((element: HTMLInputElement) => ({
      accept: element.accept,
      multiple: element.multiple,
      nearby: element.parentElement?.parentElement?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    }));
    if (isTaobaoVideoInputCandidate(attributes)) {
      return input;
    }
  }
  throw new Error("TAOBAO_DRAMA_VIDEO_FILE_INPUT_NOT_FOUND");
}

async function batchPublishButton(page: Page) {
  return page
    .getByRole("button", { name: /批量发布/ })
    .or(page.locator("button").filter({ hasText: /批量发布/ }))
    .filter({ visible: true })
    .last();
}

async function waitForUploadComplete(
  page: Page,
  files: string[],
  options: TaobaoDramaRuntimeOptions,
) {
  const timeoutMs = Math.max(1, options.episodeUploadWaitTimeoutMinutes ?? 120) * 60_000;
  const deadline = Date.now() + timeoutMs;
  let lastLine = "";
  let uploadEvidence = false;
  let stableReadySince: number | undefined;
  while (Date.now() < deadline) {
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const summary = summarizeTaobaoUploadText(bodyText, files);
    uploadEvidence ||= summary.matchedFileCount > 0 || Boolean(summary.progressText) || summary.pending;
    const line = `${summary.matchedFileCount}/${files.length} 文件已显示` +
      `，${summary.completedFileCount}/${files.length} 文件完成` +
      `${summary.progressText ? `，页面进度=${summary.progressText}` : ""}` +
      `，上传中=${summary.pending ? "是" : "否"}，完成信号=${summary.complete ? "是" : "否"}`;
    if (line !== lastLine) {
      log(options, `[taobao-drama] 剧集上传进度：${line}`);
      lastLine = line;
    }
    if (summary.failed) {
      throw new Error("TAOBAO_DRAMA_VIDEO_UPLOAD_FAILED: 页面检测到上传失败或重新上传提示");
    }

    const publishButton = await batchPublishButton(page);
    const buttonReady = await publishButton.isEnabled().catch(() => false);
    const allFilesVisible = summary.matchedFileCount >= files.length;
    const ready = uploadEvidence && !summary.pending && buttonReady;
    if (ready && (summary.complete || allFilesVisible)) {
      log(options, `[taobao-drama] ${files.length} 个剧集视频已全部上传完成`);
      return;
    }
    if (ready) {
      stableReadySince ??= Date.now();
      if (Date.now() - stableReadySince >= 10_000) {
        log(options, `[taobao-drama] 上传状态连续稳定10秒，确认 ${files.length} 个剧集视频已上传完成`);
        return;
      }
    } else {
      stableReadySince = undefined;
    }
    await page.waitForTimeout(1_000);
  }
  throw new Error(`TAOBAO_DRAMA_VIDEO_UPLOAD_TIMEOUT: expected=${files.length}`);
}

async function publishSucceeded(page: Page, urlBeforeSubmit: string) {
  if (
    page.url() !== urlBeforeSubmit &&
    isTaobaoCreatorSuccessNavigation(page.url(), "batch")
  ) return true;
  return page
    .getByText(/批量发布成功|发布成功|提交成功|全部发布完成/)
    .filter({ visible: true })
    .first()
    .isVisible()
    .catch(() => false);
}

async function clickBatchPublish(page: Page, options: TaobaoDramaRuntimeOptions) {
  const publishButton = await batchPublishButton(page);
  await publishButton.waitFor({ state: "visible", timeout: 60_000 });
  if (!(await publishButton.isEnabled())) throw new Error("TAOBAO_DRAMA_BATCH_PUBLISH_NOT_READY");
  const urlBeforeSubmit = page.url();
  await publishButton.click({ timeout: 30_000 });

  const confirmDialog = page
    .locator(".next-dialog:visible, .ant-modal:visible, .semi-modal:visible, [role='dialog']:visible")
    .filter({ hasText: /发布/ })
    .last();
  let clickedAt = Date.now();
  if (await confirmDialog.isVisible({ timeout: 2_000 }).catch(() => false)) {
    const confirm = confirmDialog
      .getByRole("button", { name: /^\s*(?:确认发布|确定|确认)\s*$/ })
      .filter({ visible: true })
      .last();
    await confirm.click({ timeout: 30_000 });
    clickedAt = Date.now();
  }
  log(options, "[taobao-drama] 已点击批量发布，进入至少10秒结算期");

  let success = false;
  const deadline = clickedAt + 60_000;
  while (Date.now() < deadline) {
    success ||= await publishSucceeded(page, urlBeforeSubmit);
    if (success && Date.now() - clickedAt >= TAOBAO_DRAMA_MIN_SETTLE_MS) break;
    const failure = await page
      .getByText(/发布失败|提交失败/)
      .filter({ visible: true })
      .first()
      .innerText()
      .catch(() => "");
    if (failure) throw new Error(`TAOBAO_DRAMA_BATCH_PUBLISH_FAILED: ${failure}`);
    await page.waitForTimeout(250);
  }
  if (!success) throw new Error("TAOBAO_DRAMA_BATCH_PUBLISH_RESULT_NOT_RECOGNIZED");
  const remaining = TAOBAO_DRAMA_MIN_SETTLE_MS - (Date.now() - clickedAt);
  if (remaining > 0) await page.waitForTimeout(remaining);
  log(options, "[taobao-drama] 批量发布成功且10秒结算期完成");
}

export async function uploadAndPublishTaobaoEpisodes(
  page: Page,
  task: ClaimedTaobaoDramaTask,
  options: TaobaoDramaRuntimeOptions,
) {
  await validateTaobaoEpisodeVideos(task, options);
  const episodes = await findTaobaoEpisodeVideos(task, options);
  const files = episodes.map((episode) => episode.file);
  log(options, `[taobao-drama] 准备上传 ${files.length} 个剧集视频，不修改单集默认信息`);

  for (let offset = 0; offset < files.length; offset += maxFilesPerSelection) {
    const batch = files.slice(offset, offset + maxFilesPerSelection);
    const input = await videoInput(page);
    await input.setInputFiles(batch, { timeout: 120_000 });
    log(
      options,
      `[taobao-drama] 已选择第 ${Math.floor(offset / maxFilesPerSelection) + 1} 批视频：` +
        `${batch.length} 个，首文件=${path.basename(batch[0] ?? "-")}`,
    );
    await page.waitForTimeout(500);
  }

  await waitForUploadComplete(page, files, options);
  await clickBatchPublish(page, options);
}
