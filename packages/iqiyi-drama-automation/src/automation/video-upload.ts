import path from "node:path";

import {
  cleanupEpisodeUploadFiles,
  prepareEpisodeUploadFiles,
  type PreparedEpisodeUploadFiles,
} from "@drama/drama-media-assets";
import type { Locator, Page } from "playwright";

import { log } from "../shared/logger.js";
import type { ClaimedIqiyiDramaTask, IqiyiDramaRuntimeOptions } from "../shared/types.js";
import { throwIfIqiyiFormInvalid } from "./form-controls.js";

const maximumFilesPerSelection = 50;
const uploadPollIntervalMs = 2_000;
const videoInputSelector = [
  "input[type='file'][multiple][accept*='.mp4']",
  "input[type='file'][multiple][accept*='.mov']",
  "input[type='file'][multiple][accept*='.mkv']",
].join(",");

type IqiyiVideoUploadRow = {
  fileName: string;
  uploading: boolean;
  failed: boolean;
  terminal: boolean;
  errorText: string;
};

type IqiyiVideoUploadSnapshot = {
  rows: IqiyiVideoUploadRow[];
  globalErrors: string[];
};

function normalizeText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function iqiyiVideoUploadRoot(page: Page) {
  const root = page.locator(".proj-catalog-wrap")
    .filter({ has: page.locator(videoInputSelector) })
    .filter({ visible: true })
    .last();
  await root.waitFor({ state: "visible", timeout: 30_000 });
  return root;
}

async function readIqiyiVideoUploadSnapshot(
  page: Page,
  root: Locator,
): Promise<IqiyiVideoUploadSnapshot> {
  const rows = await root.locator(".catalog-item-form:visible").evaluateAll((elements) =>
    elements.map((element) => {
      const status = element.querySelector(".file-status");
      const statusIcon = status?.querySelector("svg");
      const statusMarkup = statusIcon?.outerHTML.toLowerCase() ?? "";
      const statusStyle = statusIcon
        ? `${getComputedStyle(statusIcon).color} ${getComputedStyle(statusIcon).fill}`.toLowerCase()
        : "";
      const errorText = Array.from(element.querySelectorAll([
        ".mp-form-item__error",
        ".file-message-list",
        "[class*='error']",
        "[class*='fail']",
      ].join(",")))
        .filter((node) => {
          const style = getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden";
        })
        .map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? "")
        .filter(Boolean)
        .join("；");
      const uploading = Boolean(status?.querySelector(".left,.right,.leftcircle,.rightcircle"));
      const failed = Boolean(errorText)
        || /fail|error|failed|batch-failed|#f45c50|#fa4b5c|rgb\(244,\s*92,\s*80\)/u
          .test(`${statusMarkup} ${statusStyle}`);
      return {
        fileName: element.querySelector(".catalog-form-text")?.textContent?.trim()
          || element.textContent?.trim()
          || "",
        uploading,
        failed,
        terminal: Boolean(statusIcon) && !uploading,
        errorText,
      };
    })
  );
  const globalErrors = (await page.locator([
    ".mp-message--error:visible",
    ".el-message--error:visible",
    ".mp-toast--error:visible",
    ".mp-form-item__error:visible",
    "[class*='upload-error']:visible",
    "[class*='upload-fail']:visible",
  ].join(",")).allInnerTexts().catch(() => []))
    .map(normalizeText)
    .filter(Boolean);
  return { rows, globalErrors: [...new Set(globalErrors)] };
}

function expectedFileMatched(row: IqiyiVideoUploadRow, file: string) {
  const basename = path.basename(file);
  const stem = path.basename(file, path.extname(file));
  const text = normalizeText(row.fileName);
  return text.includes(basename) || text.includes(stem);
}

async function waitForIqiyiVideoUploadComplete(
  page: Page,
  root: Locator,
  expectedFiles: string[],
  deadline: number,
  options: IqiyiDramaRuntimeOptions,
) {
  let stableCompletePolls = 0;
  let lastProgress = "";
  let lastSnapshot: IqiyiVideoUploadSnapshot = { rows: [], globalErrors: [] };

  while (Date.now() < deadline) {
    lastSnapshot = await readIqiyiVideoUploadSnapshot(page, root);
    const failedRows = lastSnapshot.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.failed);
    if (lastSnapshot.globalErrors.length > 0 || failedRows.length > 0) {
      const rowErrors = failedRows.map(({ row, index }) =>
        `第${index + 1}行${row.errorText ? `：${row.errorText}` : "上传失败"}`
      );
      throw new Error(
        `IQIYI_DRAMA_VIDEO_UPLOAD_FAILED: ${[
          ...lastSnapshot.globalErrors,
          ...rowErrors,
        ].join("；")}`,
      );
    }

    const matchedCount = expectedFiles.filter((file, index) => {
      const row = lastSnapshot.rows[index];
      return row ? expectedFileMatched(row, file) : false;
    }).length;
    const terminalCount = lastSnapshot.rows.filter((row) => row.terminal).length;
    const uploadingCount = lastSnapshot.rows.filter((row) => row.uploading).length;
    const progress = `${terminalCount}/${expectedFiles.length}（行=${lastSnapshot.rows.length}`
      + `，文件名匹配=${matchedCount}，上传中=${uploadingCount}）`;
    if (progress !== lastProgress) {
      lastProgress = progress;
      log(options, `[iqiyi-drama] episode upload progress: ${progress}`);
    }

    const complete = lastSnapshot.rows.length === expectedFiles.length
      && matchedCount === expectedFiles.length
      && terminalCount === expectedFiles.length
      && uploadingCount === 0;
    stableCompletePolls = complete ? stableCompletePolls + 1 : 0;
    if (stableCompletePolls >= 2) {
      log(options, `[iqiyi-drama] all ${expectedFiles.length} episode videos uploaded`);
      return;
    }
    await page.waitForTimeout(uploadPollIntervalMs);
  }

  throw new Error(
    `IQIYI_DRAMA_VIDEO_UPLOAD_TIMEOUT: expected=${expectedFiles.length} `
      + `rows=${lastSnapshot.rows.length} status=${lastProgress || "not-started"}`,
  );
}

export async function uploadIqiyiEpisodeVideos(
  page: Page,
  task: ClaimedIqiyiDramaTask,
  options: IqiyiDramaRuntimeOptions,
) {
  const localMaterialRoot = options.localMaterialRoot?.trim();
  if (!localMaterialRoot) throw new Error("IQIYI_DRAMA_LOCAL_MATERIAL_ROOT_REQUIRED");
  const uploadRootDir = options.assetDownloadDir?.trim();
  if (!uploadRootDir) throw new Error("IQIYI_DRAMA_EPISODE_UPLOAD_ASSET_DIR_REQUIRED");

  const root = await iqiyiVideoUploadRoot(page);
  const input = root.locator(videoInputSelector).last();
  await input.waitFor({ state: "attached", timeout: 30_000 });
  const existingRowCount = await root.locator(".catalog-item-form:visible").count();
  if (existingRowCount > 0) {
    throw new Error(`IQIYI_DRAMA_VIDEO_UPLOAD_PAGE_NOT_EMPTY: rows=${existingRowCount}`);
  }

  let prepared: PreparedEpisodeUploadFiles | null = null;
  try {
    prepared = await prepareEpisodeUploadFiles({
      localEpisodeVideoRoot: localMaterialRoot,
      resourceName: task.originalTitle,
      uploadRootDir,
      uploadBaseName: task.playlet.title,
    });
    if (prepared.files.length !== task.playlet.episodeCount) {
      throw new Error(
        `IQIYI_DRAMA_EPISODE_UPLOAD_FILE_COUNT_INVALID: `
          + `actual=${prepared.files.length} expected=${task.playlet.episodeCount}`,
      );
    }

    const timeoutMinutes = Math.max(1, options.videoUploadTimeoutMinutes ?? 120);
    const deadline = Date.now() + timeoutMinutes * 60_000;
    const selectedFiles: string[] = [];
    const batchCount = Math.ceil(prepared.files.length / maximumFilesPerSelection);
    log(
      options,
      `[iqiyi-drama] uploading ${prepared.files.length} episode videos in ${batchCount} batch(es); `
        + `timeout=${timeoutMinutes} minutes`,
    );

    for (let offset = 0; offset < prepared.files.length; offset += maximumFilesPerSelection) {
      const batch = prepared.files.slice(offset, offset + maximumFilesPerSelection);
      const batchNumber = Math.floor(offset / maximumFilesPerSelection) + 1;
      const currentInput = root.locator(videoInputSelector).last();
      await currentInput.waitFor({ state: "attached", timeout: 30_000 });
      log(
        options,
        `[iqiyi-drama] selecting episode upload batch ${batchNumber}/${batchCount}: `
          + `${path.basename(batch[0]!)} -> ${path.basename(batch[batch.length - 1]!)}`,
      );
      await currentInput.setInputFiles(batch, { timeout: 20 * 60_000 });
      selectedFiles.push(...batch);
      await waitForIqiyiVideoUploadComplete(page, root, selectedFiles, deadline, options);
    }

    await throwIfIqiyiFormInvalid(page);
  } catch (error) {
    throw Object.assign(
      new Error(`IQIYI_DRAMA_EPISODE_UPLOAD_ERROR: ${message(error)}`),
      { cause: error },
    );
  } finally {
    if (prepared) await cleanupEpisodeUploadFiles(prepared);
  }
}
