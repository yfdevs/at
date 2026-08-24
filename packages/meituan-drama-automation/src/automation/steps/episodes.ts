import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Locator, Page } from "playwright";
import {
  findRequiredLocalEpisodeVideos,
  validateLocalEpisodeVideos,
} from "../../shared/local-episode-videos.js";
import type {
  ClaimedMeituanDramaTask,
  MeituanCreationRuntimeOptions,
} from "../../shared/types.js";
import { log } from "../browser-session.js";
import { scrollLocatorIntoView } from "../form-controls.js";

const videoUploadRowsSelector = "#video-list .tab-video, .video-list .tab-video";
const videoUploadProgressTimeoutMs = 2 * 60 * 60 * 1000;
const videoUploadProgressPollMs = 2_000;
const videoUploadStartPollMs = 1_000;
const videoUploadStartWaitMsByAttempt = [20_000, 30_000] as const;
const visibleDrawerSelector =
  ".mtd-drawer:visible, .mtd-drawer-wrapper:visible, .mtd-drawer-container:visible";
const collectionVideoInputSelector = [
  "#video-list input[type='file']",
  ".video-list input[type='file']",
].join(", ");
const multipleVideoInputSelector = [
  "input.mtd-upload-input[type='file'][multiple][accept*='video' i]",
  "input.mtd-upload-input[type='file'][multiple][accept*='.mp4' i]",
  "input[type='file'][multiple][accept*='video' i]",
  "input[type='file'][multiple][accept*='.mp4' i]",
].join(", ");

type VideoUploadRow = {
  indexText: string;
  fileName: string;
  uploaded: boolean;
  failed: boolean;
  errorText: string;
  retryAvailable: boolean;
};

type VideoUploadStartSnapshot = {
  rowCount: number;
  matchedFileNames: string[];
};

type FileInputSnapshot = {
  accept: string;
  className: string;
  disabled: boolean;
  multiple: boolean;
  visible: boolean;
};

function normalizeUiText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function unknownErrorMessage(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return error.toString();
  }
  try {
    return JSON.stringify(error) ?? Object.prototype.toString.call(error);
  } catch {
    return Object.prototype.toString.call(error);
  }
}

async function usableFileInput(locator: Locator, requireMultiple = false) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    const usable = await candidate
      .evaluate((element: HTMLInputElement) => (
        element.isConnected &&
        element.type === "file" &&
        !element.disabled &&
        (!requireMultiple || element.multiple)
      ))
      .catch(() => false);
    if (usable) return candidate;
  }
  return null;
}

async function videoInputNearVisibleDragger(page: Page, requireMultiple: boolean) {
  const draggers = page.locator(".mtd-upload-dragger:visible");
  const count = await draggers.count();
  for (let index = 0; index < count; index += 1) {
    const dragger = draggers.nth(index);
    const input = await usableFileInput(
      dragger
        .locator("xpath=..")
        .locator("input[type='file'], .mtd-upload-input")
        .or(
          dragger.locator(
            "xpath=following-sibling::*[contains(concat(' ', normalize-space(@class), ' '), ' mtd-upload-input ')][1]",
          ),
        ),
      requireMultiple,
    );
    if (input) {
      await scrollLocatorIntoView(page, dragger);
      return input;
    }
  }
  return null;
}

async function episodeVideoInput(page: Page, expectedFileCount: number, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  const requireMultiple = expectedFileCount > 1;
  while (Date.now() < deadline) {
    if ((await page.locator(visibleDrawerSelector).count()) > 0) {
      const drawerText = (await page.locator(visibleDrawerSelector).last().innerText().catch(() => ""))
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);
      throw new Error(
        `MEITUAN_VIDEO_UPLOAD_BLOCKED_BY_DRAWER: ${drawerText || "visible collection drawer"}`,
      );
    }

    // Prefer the collection-specific list. The page keeps the ordinary single-video
    // uploader mounted in another tab, so a generic video input can silently target
    // the wrong workflow. For multi-episode tasks, never accept a single-file input.
    const collectionInput = await usableFileInput(
      page.locator(collectionVideoInputSelector),
      requireMultiple,
    );
    if (collectionInput) return collectionInput;

    const multipleInput = await usableFileInput(page.locator(multipleVideoInputSelector));
    if (multipleInput) return multipleInput;

    const draggerInput = await videoInputNearVisibleDragger(page, requireMultiple);
    if (draggerInput) return draggerInput;

    const uploadErrorText = await readReplaceModalContentEvent(page);
    if (uploadErrorText) {
      throw new Error(`MEITUAN_VIDEO_UPLOAD_INVALID: ${uploadErrorText}`);
    }
    await page.waitForTimeout(500);
  }

  const inputSnapshots = await page
    .locator('input[type="file"]')
    .evaluateAll((elements: HTMLInputElement[]) => elements.map((element) => ({
      accept: element.accept,
      className: element.className,
      disabled: element.disabled,
      multiple: element.multiple,
    })))
    .catch(() => []);
  const visibleModalTexts = (await page.locator(".mtd-modal:visible").allInnerTexts().catch(() => []))
    .map((text) => text.replace(/\s+/g, " ").trim().slice(0, 300))
    .filter(Boolean);
  throw new Error(
    `MEITUAN_VIDEO_UPLOAD_CONTROL_NOT_READY: url=${page.url()} ` +
      `draggers=${await page.locator(".mtd-upload-dragger").count()} ` +
      `visibleDraggers=${await page.locator(".mtd-upload-dragger:visible").count()} ` +
      `fileInputs=${JSON.stringify(inputSnapshots)} ` +
      `visibleModals=${visibleModalTexts.join(" | ") || "(none)"}`,
  );
}

async function fileInputSnapshot(input: Locator): Promise<FileInputSnapshot> {
  return input.evaluate((element: HTMLInputElement) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      accept: element.accept,
      className: element.className,
      disabled: element.disabled,
      multiple: element.multiple,
      visible:
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0,
    };
  });
}

async function readVideoUploadStartSnapshot(
  page: Page,
  videoFiles: string[],
): Promise<VideoUploadStartSnapshot> {
  const rows = await readVideoUploadRows(page);
  const fileNames = videoFiles.map((file) => basename(file));
  const matchedFileNames = await page.evaluate((names) => {
    const bodyText = document.body?.innerText ?? "";
    return names.filter((name) => bodyText.includes(name)).slice(0, 10);
  }, fileNames);
  return {
    rowCount: rows.length,
    matchedFileNames,
  };
}

function uploadStarted(snapshot: VideoUploadStartSnapshot) {
  return snapshot.rowCount > 0 || snapshot.matchedFileNames.length > 0;
}

async function waitForVideoUploadStart(
  page: Page,
  videoFiles: string[],
  timeoutMs: number,
): Promise<VideoUploadStartSnapshot> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const uploadErrorText = await readReplaceModalContentEvent(page);
    if (uploadErrorText) {
      throw new Error(`MEITUAN_VIDEO_UPLOAD_INVALID: ${uploadErrorText}`);
    }

    const snapshot = await readVideoUploadStartSnapshot(page, videoFiles);
    if (uploadStarted(snapshot)) return snapshot;
    await page.waitForTimeout(videoUploadStartPollMs);
  }

  return readVideoUploadStartSnapshot(page, videoFiles);
}

function shouldFailWithoutUploadStartRetry(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /MEITUAN_VIDEO_UPLOAD_INVALID|Target page, context or browser has been closed/i.test(message);
}

async function saveVideoUploadStartDiagnostics(options: {
  page: Page;
  task: ClaimedMeituanDramaTask;
  runtimeOptions: MeituanCreationRuntimeOptions;
  videoFiles: string[];
  attempts: number;
  lastSnapshot: VideoUploadStartSnapshot;
  lastInputSnapshot: FileInputSnapshot | null;
  lastError: unknown;
}) {
  const {
    page,
    task,
    runtimeOptions,
    videoFiles,
    attempts,
    lastSnapshot,
    lastInputSnapshot,
    lastError,
  } = options;
  if (!runtimeOptions.logFilePath) return null;

  const taskSegment = String(task.accountTaskId).replace(/[^a-zA-Z0-9_-]/g, "_");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const diagnosticDir = join(
    dirname(runtimeOptions.logFilePath),
    "diagnostics",
    `${taskSegment}-${timestamp}`,
  );
  await mkdir(diagnosticDir, { recursive: true });

  const allFileInputs = await page
    .locator('input[type="file"]')
    .evaluateAll((elements: HTMLInputElement[]) => elements.map((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        accept: element.accept,
        className: element.className,
        disabled: element.disabled,
        multiple: element.multiple,
        visible:
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) !== 0 &&
          rect.width > 0 &&
          rect.height > 0,
      };
    }))
    .catch(() => []);
  const videoFileDetails = await Promise.all(videoFiles.map(async (file) => ({
    name: basename(file),
    size: await stat(file).then((value) => value.size).catch(() => null),
  })));
  const uploadAreaHtml = await page
    .locator(".mtd-upload-dragger")
    .first()
    .evaluate((element) => element.parentElement?.outerHTML ?? element.outerHTML)
    .catch(() => "");
  const record = {
    time: new Date().toISOString(),
    platform: "meituan-drama",
    accountTaskId: task.accountTaskId,
    attempts,
    expectedCount: videoFiles.length,
    visibleUploadRows: lastSnapshot.rowCount,
    matchedFileNames: lastSnapshot.matchedFileNames,
    matchedFileInputs: allFileInputs.length,
    selectedInput: lastInputSnapshot,
    activeUrl: page.url(),
    lastError: unknownErrorMessage(lastError),
    videoFiles: videoFileDetails,
  };

  await Promise.all([
    writeFile(join(diagnosticDir, "details.json"), JSON.stringify(record, null, 2), "utf8"),
    writeFile(join(diagnosticDir, "upload-area.html"), uploadAreaHtml, "utf8"),
    page.screenshot({ path: join(diagnosticDir, "page.png"), fullPage: true }),
    page.locator(".mtd-upload-dragger").first().screenshot({
      path: join(diagnosticDir, "upload-area.png"),
    }),
  ].map((operation) => operation.catch(() => undefined)));

  return diagnosticDir;
}

async function createReplaceModalContentListener(page: Page): Promise<void> {
  await page.evaluate(() => {
    const modalWindow = window as Window & {
      __modalEvents?: Array<{ text: string; time: number }>;
      __modalObserver?: MutationObserver;
    };

    modalWindow.__modalEvents = [];
    modalWindow.__modalObserver?.disconnect();

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          const element = node as HTMLElement;
          if (element.matches?.(".mtd-modal")) {
            modalWindow.__modalEvents?.push({
              text: element.innerText,
              time: Date.now(),
            });
            console.log("[modal detected]", element.innerText);
          }

          const modal = element.querySelector?.<HTMLElement>(".mtd-modal");
          if (modal) {
            modalWindow.__modalEvents?.push({
              text: modal.innerText,
              time: Date.now(),
            });
            console.log("[modal detected]", modal.innerText);
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    modalWindow.__modalObserver = observer;
  });
}

async function readReplaceModalContentEvent(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const modalWindow = window as Window & {
      __modalEvents?: Array<{ text: string; time: number }>;
    };
    return modalWindow.__modalEvents?.[0]?.text?.trim() || null;
  });
}

async function disposeReplaceModalContentListener(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      const modalWindow = window as Window & {
        __modalObserver?: MutationObserver;
      };

      modalWindow.__modalObserver?.disconnect();
      delete modalWindow.__modalObserver;
    })
    .catch(() => undefined);
}

async function readVideoUploadRows(page: Page): Promise<VideoUploadRow[]> {
  return page.evaluate((selector) => {
    const isVisible = (element: HTMLElement) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    return Array.from(document.querySelectorAll<HTMLElement>(selector)).map((row) => {
      const uploadSuccess = row.querySelector<HTMLElement>(".upload-success");
      const successText = uploadSuccess?.innerText.trim() ?? "";
      const uploadError = row.querySelector<HTMLElement>(".upload-error");
      const failed = Boolean(uploadError && isVisible(uploadError));
      const retryAvailable = Array.from(
        row.querySelectorAll<HTMLElement>(".error-btn .scale-text"),
      ).some((element) => element.innerText.trim() === "重试" && isVisible(element));
      return {
        indexText: row.querySelector<HTMLElement>(".video-index")?.innerText.trim() ?? "",
        fileName: row.querySelector<HTMLElement>(".file-name")?.innerText.trim() ?? "",
        uploaded: Boolean(
          uploadSuccess && (successText.includes("上传成功") || isVisible(uploadSuccess)),
        ),
        failed,
        errorText:
          row.querySelector<HTMLElement>(".show-error-name")?.innerText.trim() ||
          uploadError?.innerText.trim() ||
          "",
        retryAvailable,
      };
    });
  }, videoUploadRowsSelector);
}

function failedVideoUploadError(
  failures: VideoUploadRow[],
  retryAttemptsByFile: Map<string, number>,
  maxRetryAttempts: number,
) {
  const details = failures
    .map((failure, index) => {
      const fileName = failure.fileName || failure.indexText || `未知剧集-${index + 1}`;
      const errorText = failure.errorText || "页面仅显示上传失败，未提供具体原因";
      const retryAttempts = retryAttemptsByFile.get(fileName) ?? 0;
      return `${failure.indexText || "未知集号"} ${fileName}：${errorText}` +
        `（已重试 ${retryAttempts}/${maxRetryAttempts} 次）`;
    })
    .join("；");
  return new Error(
    `[upload-failed] 美团剧集视频上传失败：${details || "未读取到失败剧集信息"}`,
  );
}

async function retryFirstFailedVideoRow(
  page: Page,
  rows: VideoUploadRow[],
  retryAttemptsByFile: Map<string, number>,
  maxRetryAttempts: number,
  options: MeituanCreationRuntimeOptions,
) {
  const failures = rows.filter((row) => row.failed);
  if (failures.length === 0) return false;

  const exhausted = failures.filter((failure, index) => {
    const key = failure.fileName || failure.indexText || `未知剧集-${index + 1}`;
    return (retryAttemptsByFile.get(key) ?? 0) >= maxRetryAttempts;
  });
  if (exhausted.length > 0) {
    throw failedVideoUploadError(failures, retryAttemptsByFile, maxRetryAttempts);
  }

  const failure = failures[0];
  const key = failure.fileName || failure.indexText || "未知剧集";
  if (!failure.retryAvailable) {
    throw failedVideoUploadError(failures, retryAttemptsByFile, maxRetryAttempts);
  }

  const escapedFileName = failure.fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const row = page
    .locator(videoUploadRowsSelector)
    .filter({
      has: page.locator(".file-name").filter({
        hasText: new RegExp(`^\\s*${escapedFileName}\\s*$`),
      }),
    })
    .first();
  const retryControl = row
    .locator(".error-btn .scale-text")
    .filter({ hasText: /^\s*重试\s*$/ })
    .filter({ visible: true })
    .first();
  if ((await retryControl.count()) === 0) {
    throw failedVideoUploadError(failures, retryAttemptsByFile, maxRetryAttempts);
  }

  const nextAttempt = (retryAttemptsByFile.get(key) ?? 0) + 1;
  retryAttemptsByFile.set(key, nextAttempt);
  log(
    options,
    `[meituan-drama] retrying failed episode video: ` +
      `episode=${failure.indexText || "-"} file=${key} ` +
      `attempt=${nextAttempt}/${maxRetryAttempts} ` +
      `error=${normalizeUiText(failure.errorText) || "上传失败"}`,
  );
  await retryControl.scrollIntoViewIfNeeded({ timeout: 30_000 });
  await retryControl.click({ timeout: 30_000 });

  const leftFailedState = await row
    .locator(".upload-error:visible")
    .waitFor({ state: "hidden", timeout: 30_000 })
    .then(() => true, () => false);
  if (!leftFailedState && nextAttempt >= maxRetryAttempts) {
    const latestRows = await readVideoUploadRows(page);
    throw failedVideoUploadError(
      latestRows.filter((item) => item.failed),
      retryAttemptsByFile,
      maxRetryAttempts,
    );
  }
  return true;
}

async function waitForVideoUploadProgress(
  page: Page,
  expectedCount: number,
  options: MeituanCreationRuntimeOptions,
): Promise<void> {
  const deadline = Date.now() + videoUploadProgressTimeoutMs;
  const maxRetryAttempts = Math.max(0, options.episodeUploadFailedRetryAttempts ?? 5);
  const retryAttemptsByFile = new Map<string, number>();
  const loggedSuccessKeys = new Set<string>();
  let lastProgressLine = "";

  while (Date.now() < deadline) {
    const uploadErrorText = await readReplaceModalContentEvent(page);
    if (uploadErrorText) {
      throw new Error(`MEITUAN_VIDEO_UPLOAD_INVALID: ${uploadErrorText}`);
    }

    const rows = await readVideoUploadRows(page);
    const rowsToCheck = rows.slice(0, expectedCount);
    if (
      await retryFirstFailedVideoRow(
        page,
        rowsToCheck,
        retryAttemptsByFile,
        maxRetryAttempts,
        options,
      )
    ) {
      await page.waitForTimeout(videoUploadProgressPollMs);
      continue;
    }
    const uploadedRows = rowsToCheck.filter((row) => row.uploaded);
    const progressLine = `${uploadedRows.length}/${expectedCount} uploaded, ${rows.length} row(s) visible`;

    if (progressLine !== lastProgressLine) {
      log(options, `[meituan-drama] video upload progress: ${progressLine}`);
      lastProgressLine = progressLine;
    }

    rowsToCheck.forEach((row, index) => {
      if (!row.uploaded) return;

      const key = row.fileName || row.indexText || String(index + 1);
      if (loggedSuccessKeys.has(key)) return;

      const indexText = row.indexText || `第${index + 1}条`;
      const fileName = row.fileName ? ` ${row.fileName}` : "";
      log(options, `[meituan-drama] video upload success: ${indexText}${fileName}`);
      loggedSuccessKeys.add(key);
    });

    if (uploadedRows.length >= expectedCount) {
      log(options, `[meituan-drama] all ${expectedCount} episode video(s) uploaded`);
      return;
    }

    await page.waitForTimeout(videoUploadProgressPollMs);
  }

  const rows = await readVideoUploadRows(page);
  const rowsToCheck = rows.slice(0, expectedCount);
  const failures = rowsToCheck.filter((row) => row.failed);
  if (failures.length > 0) {
    throw failedVideoUploadError(failures, retryAttemptsByFile, maxRetryAttempts);
  }
  const uploadedCount = rowsToCheck.filter((row) => row.uploaded).length;
  throw new Error(
    `MEITUAN_VIDEO_UPLOAD_TIMEOUT: expected ${expectedCount} uploaded episode video(s), got ${uploadedCount}`,
  );
}

export async function uploadEpisodeVideosStep(
  page: Page,
  task: ClaimedMeituanDramaTask,
  options: MeituanCreationRuntimeOptions,
) {
  log(options, "[meituan-drama] preparing local episode videos");
  await validateLocalEpisodeVideos(task, options);
  const episodes = await findRequiredLocalEpisodeVideos(task, options);
  const videoFiles = episodes.map((episode) => episode.file);

  log(options, `[meituan-drama] uploading ${videoFiles.length} episode video(s)`);
  await createReplaceModalContentListener(page);
  try {
    let uploadStartedSuccessfully = false;
    let lastSnapshot: VideoUploadStartSnapshot = { rowCount: 0, matchedFileNames: [] };
    let lastInputSnapshot: FileInputSnapshot | null = null;
    let lastError: unknown;

    for (let attempt = 1; attempt <= videoUploadStartWaitMsByAttempt.length; attempt += 1) {
      const timeoutMs = videoUploadStartWaitMsByAttempt[attempt - 1];
      log(
        options,
        `[meituan-drama] video upload start attempt ${attempt}/${videoUploadStartWaitMsByAttempt.length}: ` +
          `files=${videoFiles.length} waitMs=${timeoutMs}`,
      );

      try {
        const videoInput = await episodeVideoInput(
          page,
          videoFiles.length,
          attempt === 1 ? 60_000 : 15_000,
        );
        lastInputSnapshot = await fileInputSnapshot(videoInput).catch(() => null);
        if (attempt > 1) {
          await videoInput.setInputFiles([], { timeout: 30_000 });
        }
        await videoInput.setInputFiles(videoFiles, { timeout: 120_000 });
        log(
          options,
          `[meituan-drama] episode files assigned to upload input: ` +
            `attempt=${attempt}/${videoUploadStartWaitMsByAttempt.length} files=${videoFiles.length}`,
        );
        lastSnapshot = await waitForVideoUploadStart(page, videoFiles, timeoutMs);
        if (uploadStarted(lastSnapshot)) {
          uploadStartedSuccessfully = true;
          log(
            options,
            `[meituan-drama] video upload started: attempt=${attempt} ` +
              `rows=${lastSnapshot.rowCount} matchedFileNames=${lastSnapshot.matchedFileNames.length}`,
          );
          break;
        }
      } catch (error) {
        lastError = error;
        if (shouldFailWithoutUploadStartRetry(error)) throw error;
        log(
          options,
          `[meituan-drama] video upload start attempt failed: ` +
            `attempt=${attempt}/${videoUploadStartWaitMsByAttempt.length} ` +
            `error=${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (attempt < videoUploadStartWaitMsByAttempt.length) {
        lastSnapshot = await readVideoUploadStartSnapshot(page, videoFiles);
        if (uploadStarted(lastSnapshot)) {
          uploadStartedSuccessfully = true;
          log(
            options,
            `[meituan-drama] video upload started before retry: ` +
              `rows=${lastSnapshot.rowCount} matchedFileNames=${lastSnapshot.matchedFileNames.length}`,
          );
          break;
        }
        log(
          options,
          `[meituan-drama] no upload rows after ${timeoutMs}ms, retrying file selection once`,
        );
      }
    }

    if (!uploadStartedSuccessfully) {
      const diagnosticDir = await saveVideoUploadStartDiagnostics({
        page,
        task,
        runtimeOptions: options,
        videoFiles,
        attempts: videoUploadStartWaitMsByAttempt.length,
        lastSnapshot,
        lastInputSnapshot,
        lastError,
      }).catch(() => null);
      const detail = {
        attempts: videoUploadStartWaitMsByAttempt.length,
        expectedCount: videoFiles.length,
        visibleUploadRows: lastSnapshot.rowCount,
        matchedFileNames: lastSnapshot.matchedFileNames.length,
        selectedInput: lastInputSnapshot,
        diagnosticDir,
        lastError: unknownErrorMessage(lastError),
      };
      throw new Error(`MEITUAN_VIDEO_UPLOAD_NOT_STARTED: ${JSON.stringify(detail)}`);
    }

    await waitForVideoUploadProgress(page, videoFiles.length, options);
  } finally {
    await disposeReplaceModalContentListener(page);
  }

  log(options, "[meituan-drama] episode video files submitted");
}
