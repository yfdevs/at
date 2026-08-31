import type { Locator, Page } from "playwright";
import {
  cleanupEpisodeUploadFiles,
  prepareEpisodeUploadFiles,
} from "@drama/drama-media-assets";
import { resolveRunDataPath } from "../../shared/config.js";
import { createLogger } from "../../shared/logger.js";
import { getWechatMiniProgramRuntimeSettings } from "../../shared/runtime-settings.js";
import { secondsSettingToMs } from "../../shared/settings-value.js";
import type { Config, PreparedEpisodeVideo } from "../../shared/types.js";
import { uploadPagePath } from "../constants.js";
import { gotoMiniProgramPage } from "../portal-navigation.js";
import { monitorEpisodeVodUploads } from "../upload/vod-monitor.js";

interface EpisodeUploadStepOptions {
  episodeVideos?: PreparedEpisodeVideo[];
  videoAccountLabel?: string;
}

const uploadLogger = createLogger("upload");

function normalizeUiText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function episodeUploadWaitTimeoutMs(): number {
  return secondsSettingToMs(
    getWechatMiniProgramRuntimeSettings().episodeUploadWaitTimeoutSeconds,
    120 * 60,
  );
}

async function visibleErrorTexts(page: Page): Promise<string[]> {
  const selectors = [
    ".weui-toptips__inner",
    ".errmsg",
    ".status-error",
    ".weui-desktop-form__msg_warn",
  ];
  const texts: string[] = [];
  for (const selector of selectors) {
    const matches = page.locator(selector);
    const count = await matches.count();
    for (let index = 0; index < count; index += 1) {
      const item = matches.nth(index);
      if (!await item.isVisible().catch(() => false)) continue;
      const text = normalizeUiText(await item.innerText().catch(() => ""));
      if (text) texts.push(text);
    }
  }
  return Array.from(new Set(texts));
}

async function waitForPreparedUploadRows(page: Page, expectedCount: number): Promise<void> {
  const rows = page.locator("table tbody tr");
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const rowCount = await rows.count();
    if (rowCount === expectedCount) return;
    const errors = await visibleErrorTexts(page);
    if (errors.length > 0) {
      throw new Error(`[episode-upload-validation-failed] ${errors.join("；")}`);
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`[upload-failed] 本地上传列表未出现完整剧集：期望 ${expectedCount} 集。`);
}

async function cleanupEpisodeUploadDir(uploadDir: string, accountLabel?: string): Promise<void> {
  await cleanupEpisodeUploadFiles({ uploadDir, files: [] }).catch((error: unknown) => {
    uploadLogger.warn("临时剧集目录清理失败", {
      accountName: accountLabel,
      path: uploadDir,
      error,
    });
  });
}

export async function uploadEpisodeFilesStep(
  page: Page,
  config: Config,
  options: EpisodeUploadStepOptions = {},
): Promise<void> {
  await gotoMiniProgramPage(page, uploadPagePath);
  await page.getByRole("heading", { name: "视频上传" }).waitFor({ state: "visible", timeout: 30000 });

  const prepared = await prepareEpisodeUploadFiles({
    localEpisodeVideoRoot: getWechatMiniProgramRuntimeSettings().localEpisodeVideoRoot,
    resourceName: config.originalTitle,
    uploadRootDir: resolveRunDataPath(),
    uploadBaseName: config.playlet.name,
    episodes: options.episodeVideos,
  });

  try {
    const videoFiles = prepared.files;
    if (videoFiles.length !== config.playlet.episodeCount) {
      throw new Error(
        `[upload-failed] 剧集视频：期望 ${config.playlet.episodeCount} 个本地文件，实际 ${videoFiles.length} 个。`,
      );
    }

    const batches = Array.from(
      { length: Math.ceil(videoFiles.length / 100) },
      (_, index) => videoFiles.slice(index * 100, (index + 1) * 100),
    );
    let uploadedCount = 0;

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex];
      if (batchIndex > 0) {
        await gotoMiniProgramPage(page, uploadPagePath);
        await page.getByRole("heading", { name: "视频上传" })
          .waitFor({ state: "visible", timeout: 30000 });
      }

      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(batch, { timeout: 120000 });
      await waitForPreparedUploadRows(page, batch.length);

      const startButton = page.getByRole("button", { name: "开始上传", exact: true });
      await startButton.waitFor({ state: "visible", timeout: 30000 });
      uploadLogger.info("本地剧集已加入上传列表", {
        accountName: options.videoAccountLabel,
        batch: batchIndex + 1,
        batchCount: batches.length,
        episodeCount: batch.length,
      });

      const report = await monitorEpisodeVodUploads(
        page,
        batch.length,
        () => startButton.click({ timeout: 30000 }),
        episodeUploadWaitTimeoutMs(),
      );
      if (report.successes.length !== batch.length) {
        throw new Error(
          `[upload-failed] 微信小程序素材库第 ${batchIndex + 1} 批仅确认 ${report.successes.length}/${batch.length} 集上传成功。`,
        );
      }
      uploadedCount += report.successes.length;

      const errors = await visibleErrorTexts(page);
      if (errors.length > 0) {
        throw new Error(`[upload-failed] 微信页面提示：${errors.join("；")}`);
      }
    }
    uploadLogger.info("本地剧集已全部上传到微信小程序素材库", {
      accountName: options.videoAccountLabel,
      episodeCount: uploadedCount,
    });
  } finally {
    await cleanupEpisodeUploadDir(prepared.uploadDir, options.videoAccountLabel);
  }
}

function escapedRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function episodeIndexFromRow(text: string, playletName: string): number | null {
  const match = normalizeUiText(text).match(
    new RegExp(`^${escapedRegex(playletName)}\\s*-\\s*第(\\d+)集(?:\\.mp4)?`, "i"),
  );
  return match ? Number(match[1]) : null;
}

async function setRowChecked(row: Locator, checked: boolean): Promise<void> {
  const checkbox = row.locator('input[type="checkbox"]').first();
  if (await checkbox.count()) {
    await checkbox.setChecked(checked, { force: true, timeout: 15000 });
    return;
  }

  const cell = row.locator("td").first();
  await cell.click({ timeout: 15000 });
}

async function nextPage(page: Page, previousFirstRow: string): Promise<boolean> {
  const next = page.getByText("下一页", { exact: true }).first();
  if (!await next.isVisible().catch(() => false)) return false;
  const className = await next.getAttribute("class");
  const ariaDisabled = await next.getAttribute("aria-disabled");
  if (ariaDisabled === "true" || /disabled/i.test(className ?? "")) return false;

  await next.click({ timeout: 15000 });
  await page.waitForFunction((previous) => {
    const row = document.querySelector("table tbody tr");
    return (row?.textContent ?? "").replace(/\s+/g, " ").trim() !== previous;
  }, previousFirstRow, { timeout: 15000 }).catch(() => page.waitForTimeout(1000));
  return true;
}

export async function selectUploadedEpisodeFilesStep(page: Page, config: Config): Promise<void> {
  const expectedCount = config.playlet.episodeCount;
  const searchInput = page.getByPlaceholder("搜索文件名").first();
  await searchInput.waitFor({ state: "visible", timeout: 30000 });
  await searchInput.fill(config.playlet.name);
  await searchInput.press("Enter").catch(() => undefined);
  await page.waitForTimeout(1000);

  const selectedIndexes = new Set<number>();
  for (let pageIndex = 0; pageIndex < 30 && selectedIndexes.size < expectedCount; pageIndex += 1) {
    const rows = page.locator("table tbody tr");
    const rowCount = await rows.count();
    let firstRowText = "";

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const row = rows.nth(rowIndex);
      if (!await row.isVisible().catch(() => false)) continue;
      const rowText = normalizeUiText(await row.innerText().catch(() => ""));
      firstRowText ||= rowText;
      const episodeIndex = episodeIndexFromRow(rowText, config.playlet.name);
      if (!episodeIndex || episodeIndex < 1 || episodeIndex > expectedCount) continue;

      if (selectedIndexes.has(episodeIndex)) {
        await setRowChecked(row, false).catch(() => undefined);
        continue;
      }
      await setRowChecked(row, true);
      selectedIndexes.add(episodeIndex);
    }

    if (selectedIndexes.size >= expectedCount) break;
    if (!await nextPage(page, firstRowText)) break;
  }

  const missingIndexes = Array.from({ length: expectedCount }, (_, index) => index + 1)
    .filter((index) => !selectedIndexes.has(index));
  if (missingIndexes.length > 0) {
    throw new Error(
      `[episode-selection-failed] 已上传文件库缺少 ${config.playlet.name} 的第 ${missingIndexes.join("、")} 集。`,
    );
  }

  const selectedSummary = page.getByText(new RegExp(`已选\\s*${expectedCount}\\s*/\\s*${expectedCount}\\s*集`)).first();
  await selectedSummary.waitFor({ state: "visible", timeout: 15000 }).catch(async () => {
    const pageText = normalizeUiText(await page.locator("body").innerText().catch(() => ""));
    if (!new RegExp(`已选\\s*${expectedCount}\\s*/\\s*${expectedCount}\\s*集`).test(pageText)) {
      throw new Error(`[episode-selection-failed] 页面未确认已选 ${expectedCount}/${expectedCount} 集。`);
    }
  });

  const confirmButton = page.getByRole("button", { name: "确认提审", exact: true }).first();
  await confirmButton.waitFor({ state: "visible", timeout: 30000 });
  await confirmButton.click({ timeout: 30000 });
  await page.waitForTimeout(1000);

  const errors = await visibleErrorTexts(page);
  if (errors.length > 0) {
    throw new Error(`[confirm-review-validation-failed] ${errors.join("；")}`);
  }
  uploadLogger.info("已从微信小程序上传文件库选择全部剧集", { episodeCount: expectedCount });
}
