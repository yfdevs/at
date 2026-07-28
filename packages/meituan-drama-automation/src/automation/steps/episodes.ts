import type { Page } from "playwright";
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

type VideoUploadRow = {
  indexText: string;
  fileName: string;
  uploaded: boolean;
  failed: boolean;
  errorText: string;
  retryAvailable: boolean;
};

function normalizeUiText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

async function episodeVideoInputByDragger(page: Page) {
  const dragger = page.locator(".mtd-upload-dragger:visible").first();
  await dragger.waitFor({ state: "visible", timeout: 60_000 });
  await scrollLocatorIntoView(page, dragger);

  const input = dragger
    .locator(
      "xpath=following-sibling::*[1][contains(concat(' ', normalize-space(@class), ' '), ' mtd-upload-input ')]",
    )
    .first();
  await input.waitFor({ state: "attached", timeout: 30_000 });
  return input;
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
  const videoInput = await episodeVideoInputByDragger(page);
  try {
    await videoInput.setInputFiles(videoFiles, { timeout: 120_000 });
    await waitForVideoUploadProgress(page, videoFiles.length, options);
  } finally {
    await disposeReplaceModalContentListener(page);
  }

  log(options, "[meituan-drama] episode video files submitted");
}
