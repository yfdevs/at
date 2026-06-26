import type { Page } from "playwright";
import {
  findRequiredLocalEpisodeVideos,
  validateLocalEpisodeVideos,
} from "../../shared/local-episode-videos.js";
import type {
  MeituanCreationRuntimeOptions,
  MeituanCreationTaskConfig,
} from "../../shared/types.js";
import { log } from "../browser-session.js";
import { scrollLocatorIntoView } from "../form-controls.js";

const videoUploadRowsSelector = "#video-list .tab-video, .video-list .tab-video";
const videoUploadProgressTimeoutMs = 30 * 60 * 1000;
const videoUploadProgressPollMs = 2_000;

type VideoUploadRow = {
  indexText: string;
  fileName: string;
  uploaded: boolean;
};

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
      return {
        indexText: row.querySelector<HTMLElement>(".video-index")?.innerText.trim() ?? "",
        fileName: row.querySelector<HTMLElement>(".file-name")?.innerText.trim() ?? "",
        uploaded: Boolean(
          uploadSuccess && (successText.includes("上传成功") || isVisible(uploadSuccess)),
        ),
      };
    });
  }, videoUploadRowsSelector);
}

async function waitForVideoUploadProgress(
  page: Page,
  expectedCount: number,
  options: MeituanCreationRuntimeOptions,
): Promise<void> {
  const deadline = Date.now() + videoUploadProgressTimeoutMs;
  const loggedSuccessKeys = new Set<string>();
  let lastProgressLine = "";

  while (Date.now() < deadline) {
    const uploadErrorText = await readReplaceModalContentEvent(page);
    if (uploadErrorText) {
      throw new Error(`MEITUAN_VIDEO_UPLOAD_INVALID: ${uploadErrorText}`);
    }

    const rows = await readVideoUploadRows(page);
    const rowsToCheck = rows.slice(0, expectedCount);
    const uploadedRows = rowsToCheck.filter((row) => row.uploaded);
    const progressLine = `${uploadedRows.length}/${expectedCount} uploaded, ${rows.length} row(s) visible`;

    if (progressLine !== lastProgressLine) {
      log(options, `[meituan-creation] video upload progress: ${progressLine}`);
      lastProgressLine = progressLine;
    }

    rowsToCheck.forEach((row, index) => {
      if (!row.uploaded) return;

      const key = row.fileName || row.indexText || String(index + 1);
      if (loggedSuccessKeys.has(key)) return;

      const indexText = row.indexText || `第${index + 1}条`;
      const fileName = row.fileName ? ` ${row.fileName}` : "";
      log(options, `[meituan-creation] video upload success: ${indexText}${fileName}`);
      loggedSuccessKeys.add(key);
    });

    if (uploadedRows.length >= expectedCount) {
      log(options, `[meituan-creation] all ${expectedCount} episode video(s) uploaded`);
      return;
    }

    await page.waitForTimeout(videoUploadProgressPollMs);
  }

  const rows = await readVideoUploadRows(page);
  const uploadedCount = rows.slice(0, expectedCount).filter((row) => row.uploaded).length;
  throw new Error(
    `MEITUAN_VIDEO_UPLOAD_TIMEOUT: expected ${expectedCount} uploaded episode video(s), got ${uploadedCount}`,
  );
}

export async function uploadEpisodeVideosStep(
  page: Page,
  taskConfig: MeituanCreationTaskConfig,
  options: MeituanCreationRuntimeOptions,
) {
  log(options, "[meituan-creation] preparing local episode videos");
  await validateLocalEpisodeVideos(taskConfig, options.config?.localEpisodeVideoRoot);
  const episodes = await findRequiredLocalEpisodeVideos(
    taskConfig,
    options.config?.localEpisodeVideoRoot,
  );
  const videoFiles = episodes.map((episode) => episode.file);

  log(options, `[meituan-creation] uploading ${videoFiles.length} episode video(s)`);
  await createReplaceModalContentListener(page);
  const videoInput = await episodeVideoInputByDragger(page);
  try {
    await videoInput.setInputFiles(videoFiles, { timeout: 120_000 });
    await waitForVideoUploadProgress(page, videoFiles.length, options);
  } finally {
    await disposeReplaceModalContentListener(page);
  }

  log(options, "[meituan-creation] episode video files submitted");
}
