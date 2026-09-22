import type { BrowserContext, Locator, Page } from "playwright";
import { readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { fetchApprovedShortplays } from "./shortplay-manage-page.js";
import { PinduoduoUploadRecordsRepository } from "../storage/pinduoduo-upload-records-repository.js";
import type {
  PinduoduoUploadRecord,
  PinduoduoUploadRecordStage,
} from "../storage/pinduoduo-upload-records-types.js";
import { log } from "../shared/logger.js";
import type { PinduoduoDramaRuntimeOptions } from "../shared/types.js";

const CREATOR_PUBLISH_URL = "https://mcn.pinduoduo.com/home/creator/publish";
const VIDEO_EXTENSIONS = new Set([".mp4", ".wmv", ".mov", ".avi", ".m4v"]);
const UPLOAD_VERIFY_TIMEOUT_MS = 10 * 60_000;
const VIDEO_UPLOAD_INPUT_SELECTOR = 'input[data-testid="beast-core-upload-input"][accept*=".mp4"]';
const AI_CONTENT_DECLARATION_LABEL = "含AI生成内容";
const PLATFORM_UPLOAD_FAILURE_MARKER = "视频上传失败";
const POST_PUBLISH_SETTLE_MS = 10_000;

function creatorPublishUrl(options: PinduoduoDramaRuntimeOptions): string {
  const uid = options.config?.creatorUid?.trim();
  if (!uid) throw new Error("Pinduoduo creator UID is required.");
  return `${CREATOR_PUBLISH_URL}?uid=${encodeURIComponent(uid)}`;
}

function openRecordPage(
  context: BrowserContext,
  record: PinduoduoUploadRecord,
  options: PinduoduoDramaRuntimeOptions,
): Promise<Page> {
  return context.newPage().then(async (page) => {
    await page.goto(creatorPublishUrl(options), { waitUntil: "domcontentloaded", timeout: 60_000 });
    log(options, "info", "runtime", "opened creator video upload page", {
      title: record.title,
      uid: options.config?.creatorUid,
      url: page.url(),
    });
    return page;
  });
}

async function listVideoFiles(directory: string): Promise<string[]> {
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .map((entry) => join(directory, entry.name));
}

function videoCardLocator(page: Page, fileName: string): Locator {
  return page
    .locator("p", { hasText: `文件名：${fileName}` })
    .locator('xpath=ancestor::div[.//button[contains(.,"添加至已有短剧")]][1]');
}

async function fillVideoCardDetails(page: Page, card: Locator, fileName: string): Promise<void> {
  const description = fileName.replace(/\.[^.]+$/, "");
  const editor = card.locator('[contenteditable="true"]').first();
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await editor.pressSequentially(description);

  const declarationSelect = card.locator('[data-testid="beast-core-select"]').first();
  await declarationSelect.click();
  await page.getByText(AI_CONTENT_DECLARATION_LABEL, { exact: true }).first().click();
}

async function readPlatformUploadFailure(page: Page): Promise<{ rejected: boolean; reasons: string[] }> {
  return page.evaluate(
    (marker) => {
      if (!document.body.textContent?.includes(marker)) {
        return { rejected: false, reasons: [] };
      }
      const reasons = new Set<string>();
      document.querySelectorAll("span").forEach((element) => {
        const text = (element.textContent ?? "").trim();
        if (
          text.length > 0 &&
          text.length < 80 &&
          !text.includes(marker) &&
          /不能|不得低于|需满足|不支持|超过|低于/.test(text)
        ) {
          reasons.add(text);
        }
      });
      return { rejected: true, reasons: [...reasons] };
    },
    PLATFORM_UPLOAD_FAILURE_MARKER,
  );
}

async function bindVideoCardToDrama(page: Page, card: Locator, dramaTitle: string): Promise<void> {
  await card.getByRole("button", { name: "添加至已有短剧" }).first().click();
  const dialog = page.locator('[role="dialog"], [class*="modal" i], [class*="Modal" i]').last();
  await dialog.waitFor({ state: "visible", timeout: 10_000 });
  const searchInput = dialog.locator("input:visible").first();
  await searchInput.click();
  await searchInput.fill(dramaTitle);
  await page.waitForTimeout(1_500);
  await dialog.getByText(dramaTitle, { exact: true }).first().click();
  const confirmButton = dialog.getByRole("button", { name: /确定|确认|完成/ }).first();
  if ((await confirmButton.count()) > 0) {
    await confirmButton.click();
  }
  await dialog.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
}

async function publishVideoCard(page: Page, card: Locator): Promise<void> {
  const publishButton = card.getByRole("button", { name: "发布" }).first();
  await publishButton.click({ timeout: 60_000 });

  await page.waitForTimeout(1_000);
  const dialogConfirm = page
    .locator('[role="dialog"], [class*="modal" i], [class*="Modal" i]')
    .last()
    .getByRole("button", { name: /确定|确认|发布/ })
    .first();
  if (await dialogConfirm.isVisible().catch(() => false)) {
    await dialogConfirm.click();
  }

  const buttonHandle = await publishButton.elementHandle();
  await page
    .waitForFunction(
      (button) => {
        if (/发布成功|已发布/.test(document.body.textContent ?? "")) return true;
        return button instanceof HTMLButtonElement && button.disabled;
      },
      buttonHandle,
      { timeout: 60_000 },
    )
    .catch(() => {
      throw new Error("点击发布后未检测到成功信号");
    });
}

async function syncApprovedUploadRecords(
  page: Page,
  options: PinduoduoDramaRuntimeOptions,
  repository: PinduoduoUploadRecordsRepository,
): Promise<number> {
  let pageNumber = 1;
  let synced = 0;
  while (true) {
    const result = await fetchApprovedShortplays(page, options, pageNumber);
    pageNumber += 1;
    repository.upsertFromApprovedList(result.records);
    synced += result.records.filter((record) => record.id !== undefined).length;
    const scannedAll = result.totalCount !== undefined
      ? (result.page - 1) * result.pageSize + result.rawCount >= result.totalCount
      : result.rawCount < result.pageSize;
    if (scannedAll) break;
  }
  return synced;
}

async function processUploadRecord(
  context: BrowserContext,
  options: PinduoduoDramaRuntimeOptions,
  repository: PinduoduoUploadRecordsRepository,
  record: PinduoduoUploadRecord,
): Promise<boolean> {
  if (!options.config?.creatorUid?.trim()) {
    repository.markFailed(
      record.platformApplyId,
      "OPEN_PAGE",
      "未配置创作者 UID（creatorUid），无法打开发布页",
    );
    log(options, "error", "runtime", "approved shortplay upload skipped: creator UID missing", {
      platformApplyId: record.platformApplyId,
      title: record.title,
    });
    return false;
  }

  let stage: PinduoduoUploadRecordStage = "DOWNLOAD";
  try {
    repository.markDownloading(record.platformApplyId);
    let downloadPath: string | undefined;
    if (record.demoUrl && options.ensureBaiduNetdiskResource) {
      const downloadResult = await options.ensureBaiduNetdiskResource({
        shareText: record.demoUrl,
        resourceName: record.title,
        localEpisodeVideoRoot: options.config?.video?.localEpisodeVideoRoot ?? "",
        episodeCount: record.episodeCount ?? 1,
        downloadEpisodeVideos: true,
        downloadAssetMaterials: false,
        requireAllDiscoveredAssets: false,
      });
      downloadPath = downloadResult.localPath;
    }
    repository.markReady(record.platformApplyId);

    const files = downloadPath ? await listVideoFiles(downloadPath) : [];
    if (files.length === 0) {
      repository.markFailed(record.platformApplyId, "DOWNLOAD", "本地下载目录中没有可上传的视频文件");
      log(options, "error", "runtime", "approved shortplay upload skipped: no video files", {
        platformApplyId: record.platformApplyId,
        title: record.title,
        downloadPath,
      });
      return false;
    }

    repository.markUploading(record.platformApplyId);
    let uploadPage: Page | null = null;
    try {
      stage = "OPEN_PAGE";
      uploadPage = await openRecordPage(context, record, options);
      stage = "UPLOAD";
      await uploadPage.locator(VIDEO_UPLOAD_INPUT_SELECTOR).setInputFiles(files);
      await uploadPage
        .locator("p", { hasText: "文件名：" })
        .first()
        .waitFor({ state: "visible", timeout: 30_000 });

      for (const file of files) {
        const fileName = basename(file);
        await fillVideoCardDetails(uploadPage, videoCardLocator(uploadPage, fileName), fileName);
      }

      stage = "VERIFY";
      await uploadPage
        .waitForFunction(
          () => !/上传中|处理中/.test(document.body.textContent ?? ""),
          undefined,
          { timeout: UPLOAD_VERIFY_TIMEOUT_MS },
        )
        .catch((error: unknown) => {
          throw error instanceof Error && error.name === "TimeoutError"
            ? new Error("等待上传完成超时（10 分钟）")
            : error;
        });

      const platformFailure = await readPlatformUploadFailure(uploadPage);
      if (platformFailure.rejected) {
        const errorMessage = `视频上传失败${
          platformFailure.reasons.length > 0 ? `：${platformFailure.reasons.join("；")}` : ""
        }`;
        repository.markRejected(record.platformApplyId, errorMessage);
        log(options, "error", "runtime", "approved shortplay rejected by platform, will not retry", {
          platformApplyId: record.platformApplyId,
          title: record.title,
          errorMessage,
        });
        return false;
      }

      stage = "BIND";
      for (const file of files) {
        await bindVideoCardToDrama(uploadPage, videoCardLocator(uploadPage, basename(file)), record.title);
      }

      stage = "PUBLISH";
      for (const file of files) {
        await publishVideoCard(uploadPage, videoCardLocator(uploadPage, basename(file)));
      }

      await uploadPage.waitForTimeout(POST_PUBLISH_SETTLE_MS);
      repository.markUploaded(record.platformApplyId);
      log(options, "info", "runtime", "approved shortplay published", {
        platformApplyId: record.platformApplyId,
        title: record.title,
        fileCount: files.length,
      });
      return true;
    } finally {
      await uploadPage?.close().catch(() => undefined);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    repository.markFailed(record.platformApplyId, stage, errorMessage);
    log(options, "error", "runtime", "approved shortplay upload failed", {
      platformApplyId: record.platformApplyId,
      title: record.title,
      stage,
      error,
    });
    return false;
  }
}

export async function runApprovedShortplayCycle(
  page: Page,
  context: BrowserContext,
  options: PinduoduoDramaRuntimeOptions,
): Promise<number> {
  const repository = new PinduoduoUploadRecordsRepository(options);
  let uploaded = 0;
  try {
    const synced = await syncApprovedUploadRecords(page, options, repository);
    log(options, "info", "runtime", "approved upload records synced", { synced });

    const processableRecords = repository.findProcessableRecords();
    log(options, "info", "runtime", "approved upload processable records", {
      count: processableRecords.length,
    });

    for (const record of processableRecords) {
      if (await processUploadRecord(context, options, repository, record)) {
        uploaded += 1;
      }
    }
    return uploaded;
  } finally {
    repository.close();
  }
}
