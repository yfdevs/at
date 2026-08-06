import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import type { Locator, Page } from "playwright";
import { resolveRunDataPath } from "../../shared/config.js";
import { getWechatVideoRuntimeSettings } from "../../shared/runtime-settings.js";
import { secondsSettingToMs } from "../../shared/settings-value.js";
import { rootSelector } from "../constants.js";

const remoteFilePromises = new Map<string, Promise<string>>();
const defaultRemoteFileDirectoryName = "ungrouped";
const remoteFileDownloadTimeoutMs = readRemoteFileDownloadTimeoutMs();
const invalidRemoteDirectoryNameChars = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
const nonVideoUploadFileMaxBytes = 10 * 1024 * 1024;

function readRemoteFileDownloadTimeoutMs(): number {
  return secondsSettingToMs(getWechatVideoRuntimeSettings().remoteFileDownloadTimeoutSeconds, 120);
}

function isRemoteFile(filePath: string): boolean {
  return /^https?:\/\//i.test(filePath);
}

function isProjectAssetsPath(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  return !path.isAbsolute(filePath) && normalizedPath.startsWith("assets/");
}

function isVideoUploadLabel(label: string): boolean {
  return /视频|video/i.test(label);
}

function isVideoFile(filePath: string): boolean {
  return /\.(?:mp4|mov|m4v|avi|mkv|flv|wmv|webm)$/i.test(filePath);
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

async function assertNonVideoUploadFilesWithinSizeLimit(files: string[], label: string): Promise<void> {
  if (isVideoUploadLabel(label)) return;

  for (const file of files) {
    if (isVideoFile(file)) continue;
    const fileStat = await stat(file);
    if (fileStat.size <= nonVideoUploadFileMaxBytes) continue;

    throw new Error(
      `[upload-file-invalid] ${label}: 单个文件不能超过10MB；` +
        `${path.basename(file)}=${formatMegabytes(fileStat.size)}`,
    );
  }
}

function remoteFileExtension(url: URL, contentType: string | null): string {
  const extension = path.extname(url.pathname);
  if (extension && extension.length <= 10) return extension;

  const extensionsByContentType: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
  };
  return extensionsByContentType[contentType?.split(";")[0].trim().toLowerCase() ?? ""] ?? ".bin";
}

function remoteFileName(url: URL, contentType: string | null): string {
  const urlFileName = path.posix.basename(url.pathname);
  if (urlFileName && urlFileName !== "." && urlFileName !== "/") return urlFileName;

  return `remote-file${remoteFileExtension(url, contentType)}`;
}

function remoteFileDirectoryName(value?: string): string {
  const directoryName = value
    ? Array.from(value, (char) => (
      invalidRemoteDirectoryNameChars.has(char) || char.charCodeAt(0) <= 0x1f ? " " : char
    )).join("").replace(/\s+/g, " ").trim()
    : undefined;
  return directoryName || defaultRemoteFileDirectoryName;
}

async function downloadRemoteFile(fileUrl: string, directoryName?: string): Promise<string> {
  const resolvedDirectoryName = remoteFileDirectoryName(directoryName);
  const cacheKey = `${resolvedDirectoryName}\n${fileUrl}`;
  const cached = remoteFilePromises.get(cacheKey);
  if (cached) return cached;

  const download = (async () => {
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort();
    }, remoteFileDownloadTimeoutMs);

    try {
      const response = await fetch(fileUrl, {
        redirect: "follow",
        signal: abortController.signal,
      });
      if (!response.ok) {
        throw new Error(`[remote-file-download-failed] HTTP ${response.status}: ${fileUrl}`);
      }

      const url = new URL(fileUrl);
      const contentType = response.headers.get("content-type");
      const fileName = remoteFileName(url, contentType);
      const downloadDir = resolveRunDataPath("remote-upload-assets", resolvedDirectoryName);
      const target = path.join(downloadDir, fileName);
      const body = Buffer.from(await response.arrayBuffer());
      await mkdir(downloadDir, { recursive: true });
      await writeFile(target, body);
      console.log(`[download] remote upload file: ${fileUrl} -> ${target}`);
      return target;
    } catch (error) {
      if (abortController.signal.aborted) {
        throw Object.assign(new Error(
          `[remote-file-download-failed] timed out after ${remoteFileDownloadTimeoutMs}ms: ${fileUrl}; cause=${
            error instanceof Error ? error.message : String(error)
          }`,
        ), { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  })();

  remoteFilePromises.set(cacheKey, download);
  try {
    return await download;
  } catch (error) {
    remoteFilePromises.delete(cacheKey);
    throw error;
  }
}

export async function prepareUploadFiles(
  paths: Array<string | undefined>,
  resolveFromRoot: (filePath: string) => string,
  remoteDirectoryName?: string,
): Promise<string[]> {
  const files = await Promise.all(paths.filter((value): value is string => Boolean(value)).map(async (filePath) => {
    if (isRemoteFile(filePath)) {
      return downloadRemoteFile(filePath, remoteDirectoryName);
    }

    if (isProjectAssetsPath(filePath)) {
      console.warn(`[skip] project assets path ignored: ${filePath}`);
      return null;
    }

    const resolvedPath = resolveFromRoot(filePath);
    if (!existsSync(resolvedPath)) {
      console.warn(`[skip] file not found: ${resolvedPath}`);
      return null;
    }
    return resolvedPath;
  }));
  return files.filter((value): value is string => Boolean(value));
}

interface UploadUiState {
  text: string;
  html: string;
  previewCount: number;
  busyCount: number;
  inputFileCount: number;
}

class UploadUiTimeoutError extends Error {
  constructor(
    message: string,
    readonly latest: UploadUiState,
    readonly expectedFileCount: number,
  ) {
    super(message);
    this.name = "UploadUiTimeoutError";
  }
}

const uploadPreviewSelector = [
  ".img_text",
  ".weui-desktop-img-picker__item",
  ".weui-desktop-upload__preview",
  ".weui-desktop-upload__file",
  "[class*='upload'][class*='item']",
  "[class*='preview'] img",
  "[class*='file_name']",
  "[class*='filename']",
].join(",");
const uploadBusySelector = [
  ".weui-loading",
  "[class*='loading']",
  "[class*='uploading']",
  "[class*='progress']",
].join(",");
const uploadErrorSelector = [
  ".weui-desktop-form__tips_warn",
  ".weui-desktop-form__tips_error",
  ".weui-desktop-form__error",
  ".weui-desktop-upload__error",
  ".upload-error",
  "[class*='upload'][class*='error']",
].join(",");

async function visibleElementCount(locator: Locator): Promise<number> {
  return locator.evaluateAll((elements) => elements.filter((element) => {
    const htmlElement = element as HTMLElement;
    const style = getComputedStyle(htmlElement);
    const rect = htmlElement.getBoundingClientRect();
    return style.display !== "none"
      && style.visibility !== "hidden"
      && Number(style.opacity || "1") > 0
      && rect.width > 0
      && rect.height > 0;
  }).length);
}

async function readUploadUiState(container: Locator): Promise<UploadUiState> {
  const input = container.locator('input[type="file"]').first();
  return {
    text: await container.innerText().catch(() => ""),
    html: await container.innerHTML().catch(() => ""),
    previewCount: await visibleElementCount(container.locator(uploadPreviewSelector)).catch(() => 0),
    busyCount: await visibleElementCount(container.locator(uploadBusySelector)).catch(() => 0),
    inputFileCount: await input.evaluate((element) => (element as HTMLInputElement).files?.length ?? 0).catch(() => 0),
  };
}

function uploadFileNames(files: string[]): string[] {
  return files.map((filePath) => path.basename(filePath));
}

async function readVisibleUploadError(container: Locator): Promise<string> {
  const texts = await container.locator(uploadErrorSelector).evaluateAll((elements) =>
    elements.flatMap((element) => {
      const htmlElement = element as HTMLElement;
      const style = getComputedStyle(htmlElement);
      const rect = htmlElement.getBoundingClientRect();
      if (
        style.display === "none"
        || style.visibility === "hidden"
        || Number(style.opacity || "1") <= 0
        || rect.width <= 0
        || rect.height <= 0
      ) {
        return [];
      }
      const text = (htmlElement.innerText || htmlElement.textContent || "").trim();
      return text ? [text] : [];
    }),
  ).catch(() => []);
  return texts.find((text) =>
    /上传失败|重新上传|文件过大|文件大小超过|超过(?:文件)?大小限制|文件格式(?:错误|不支持)|不支持的文件/i.test(text)
  ) ?? "";
}

async function setInputFilesAndWaitForUi(
  container: Locator,
  input: Locator,
  files: string[],
  label: string,
  inputTimeout = 10000,
  uiTimeout = 60000,
): Promise<void> {
  const fileNames = uploadFileNames(files);
  const before = await readUploadUiState(container);
  console.log(`[upload-start] ${label}: ${files.length} file(s)`);
  await input.setInputFiles(files, { timeout: inputTimeout });

  const startedAt = Date.now();
  let stableSuccessChecks = 0;
  let latest = before;
  while (Date.now() - startedAt < uiTimeout) {
    latest = await readUploadUiState(container);
    const normalizedText = latest.text.replace(/\s+/g, "");
    const hasAllFileNames = fileNames.every((fileName) =>
      normalizedText.includes(fileName.replace(/\s+/g, "")));
    const previewAdded = latest.previewCount >= before.previewCount + files.length;
    const uiChanged = latest.html !== before.html;
    const uploadSelected = latest.inputFileCount >= files.length;
    const noNewBusyState = latest.busyCount <= before.busyCount;
    const failureText = await readVisibleUploadError(container);
    if (failureText) {
      throw new Error(`[upload-failed] ${label}: UI提示${failureText}`);
    }

    if ((hasAllFileNames || previewAdded || (uiChanged && uploadSelected)) && noNewBusyState) {
      stableSuccessChecks += 1;
      if (stableSuccessChecks >= 2) {
        console.log(
          `[upload-ui-ok] ${label}: files=${files.length} previews=${latest.previewCount} busy=${latest.busyCount}`,
        );
        return;
      }
    } else {
      stableSuccessChecks = 0;
    }
    await container.page().waitForTimeout(500);
  }

  throw new UploadUiTimeoutError(
    `[upload-failed] ${label}: UI在${Math.round(uiTimeout / 1000)}秒内未确认上传完成；` +
      `selected=${latest.inputFileCount}/${files.length} previews=${latest.previewCount} busy=${latest.busyCount}`,
    latest,
    files.length,
  );
}

function shouldRetryNoopUpload(error: unknown): boolean {
  return error instanceof UploadUiTimeoutError
    && error.latest.inputFileCount === 0
    && error.latest.previewCount === 0
    && error.latest.busyCount === 0
    && error.expectedFileCount > 0;
}

export async function waitForUploadedFiles(
  page: Page,
  files: string[],
  label: string,
  timeout = 60000,
): Promise<void> {
  const fileNames = uploadFileNames(files);
  if (!fileNames.length) return;

  await page.waitForFunction(
    ({ names, selector }) => {
      const container = document.querySelector(selector);
      if (!container) return false;
      const text = (container.textContent ?? "").replace(/\s+/g, "");
      return names.every((name) => text.includes(name.replace(/\s+/g, "")));
    },
    { names: fileNames, selector: rootSelector },
    { timeout },
  );
  console.log(`[upload-ui-ok] ${label}: ${fileNames.join(", ")}`);
}

export async function findVisibleLabeledGroup(
  page: Page,
  labelPrefixes: string | string[],
  expectedSelector?: string,
  timeout = 10000,
): Promise<Locator | null> {
  const prefixes = Array.isArray(labelPrefixes) ? labelPrefixes : [labelPrefixes];
  const app = page.locator(`${rootSelector}:visible`).first();
  await app.waitFor({ state: "visible", timeout }).catch(() => undefined);

  const groups = app.locator(".weui-desktop-form__control-group:visible");
  const buildCandidates = (regex: RegExp): Locator => {
    let candidates = groups.filter({
      has: app.locator(".weui-desktop-form__label").filter({ hasText: regex }),
    });
    if (expectedSelector) {
      candidates = candidates.filter({ has: app.locator(expectedSelector) });
    }
    return candidates;
  };

  for (const prefix of prefixes) {
    const exact = buildCandidates(new RegExp(`^\\s*${escapeRegex(prefix)}\\s*$`));
    if (await exact.count()) return exact.first();
  }

  for (const prefix of prefixes) {
    const startsWith = buildCandidates(new RegExp(`^\\s*${escapeRegex(prefix)}`));
    if (await startsWith.count()) return startsWith.first();
  }

  console.warn(`[skip] control group not found: ${prefixes.join(" / ")}`);
  return null;
}

export async function fileInputByLabelPrefix(page: Page, labelPrefix: string): Promise<Locator> {
  const group = page.locator(rootSelector)
    .locator(".weui-desktop-form__control-group")
    .filter({
      has: page.locator(".weui-desktop-form__label", {
        hasText: labelPrefix,
      }),
    })
    .first();

  const input = group.locator('input[type="file"]');
  await input.waitFor({ state: "attached", timeout: 10000 });

  return input;
}

export async function uploadBySelector(
  page: Page,
  selector: string,
  filePaths: Array<string | undefined>,
  label: string,
  resolveFromRoot: (filePath: string) => string,
  index = 0,
  triggerSelector?: string,
  remoteDirectoryName?: string,
): Promise<void> {
  const files = await prepareUploadFiles(filePaths, resolveFromRoot, remoteDirectoryName);
  if (!files.length) {
    console.warn(`[skip] ${label}: no existing file`);
    return;
  }
  await assertNonVideoUploadFilesWithinSizeLimit(files, label);

  const locator = page.locator(selector).nth(index);
  if (await locator.count() === 0) {
    console.warn(`[skip] selector not found for ${label}: ${selector} [${index}]`);
    return;
  }

  if (triggerSelector) {
    console.warn(`[warn] ${label}: trigger selector ignored, using input.setInputFiles directly`);
  }

  const labeledGroup = locator.locator(
    "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' weui-desktop-form__control-group ')][1]",
  );
  const uiContainer = await labeledGroup.count() > 0
    ? labeledGroup
    : page.locator(rootSelector).first();
  await setInputFilesAndWaitForUi(uiContainer, locator, files, label);
  console.log(`[upload] ${label}: ${files.length} file(s)`);
}


export async function uploadInGroup(
  group: Locator,
  filePaths: Array<string | undefined>,
  label: string,
  resolveFromRoot: (filePath: string) => string,
  remoteDirectoryName?: string,
  uiTimeout = 60000,
  uiRetryAttempts = 2,
): Promise<void> {
  const files = await prepareUploadFiles(filePaths, resolveFromRoot, remoteDirectoryName);
  if (!files.length) {
    console.warn(`[skip] ${label}: no existing file`);
    return;
  }
  await assertNonVideoUploadFilesWithinSizeLimit(files, label);

  const input = group.locator('input[type="file"]').first();
  if (await input.count() === 0) {
    console.warn(`[skip] selector not found for ${label}`);
    return;
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= uiRetryAttempts + 1; attempt += 1) {
    const attemptInput = group.locator('input[type="file"]').first();
    try {
      await attemptInput.waitFor({ state: "attached", timeout: 10000 });
      await group.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
      await setInputFilesAndWaitForUi(group, attemptInput, files, label, 10000, uiTimeout);
      console.log(`[upload] ${label}: ${files.length} file(s)`);
      return;
    } catch (error) {
      lastError = error;
      if (!shouldRetryNoopUpload(error) || attempt > uiRetryAttempts) break;
      console.warn(
        `[upload-retry] ${label}: 页面未接收到文件选择，准备第 ${attempt + 1}/${uiRetryAttempts + 1} 次重新选择文件`,
      );
      await attemptInput.setInputFiles([], { timeout: 5000 }).catch(() => undefined);
      await group.page().waitForTimeout(1200);
    }
  }

  throw lastError;
}

export async function setInputFilesByLocator(
  locator: Locator,
  files: string[],
  label: string,
  timeout = 60000,
): Promise<void> {
  if (!files.length) return;
  await assertNonVideoUploadFilesWithinSizeLimit(files, label);

  if (await locator.count() === 0) {
    throw new Error(`[upload-failed] ${label}: input[type=file] not found`);
  }

  await locator.first().setInputFiles(files, { timeout });
  console.log(`[upload] ${label}: ${files.length} file(s)`);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
