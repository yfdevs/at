import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import type { Locator, Page, Response } from "playwright";
import { resolveRunDataPath } from "../../shared/config.js";
import { getWechatVideoRuntimeSettings } from "../../shared/runtime-settings.js";
import { secondsSettingToMs } from "../../shared/settings-value.js";
import { rootSelector } from "../constants.js";

interface BizmediaUploadResponse {
  base_resp?: {
    ret?: number;
    err_msg?: string;
  };
  location?: string;
  type?: string;
  content?: string;
}

const remoteFilePromises = new Map<string, Promise<string>>();
const defaultRemoteFileDirectoryName = "ungrouped";
const remoteFileDownloadTimeoutMs = readRemoteFileDownloadTimeoutMs();

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
  const directoryName = value?.replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim();
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
        throw new Error(
          `[remote-file-download-failed] timed out after ${remoteFileDownloadTimeoutMs}ms: ${fileUrl}; cause=${
            error instanceof Error ? error.message : String(error)
          }`,
        );
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

function isBizmediaUploadResponse(response: Response): boolean {
  const urlStr = response.url();
  if (response.request().method().toUpperCase() !== "POST" || !urlStr.includes("/cgi-bin/filetransfer")) {
    return false;
  }

  try {
    const url = new URL(urlStr);
    const params = url.searchParams;
    return (
      url.hostname.endsWith("mp.weixin.qq.com")
      && url.pathname === "/cgi-bin/filetransfer"
      && params.get("action")?.toLowerCase() === "bizmedia"
      && params.get("f")?.toLowerCase() === "json"
    );
  } catch {
    return false;
  }
}

async function readBizmediaUploadResponse(response: Response): Promise<BizmediaUploadResponse | null> {
  try {
    return await response.json() as BizmediaUploadResponse;
  } catch {
    return null;
  }
}

async function waitForBizmediaUploadSuccesses(
  page: Page,
  expectedCount: number,
  label: string,
  action: () => Promise<void>,
  timeout = 180000,
  uiConfirmation?: () => Promise<void>,
): Promise<void> {
  if (expectedCount <= 0) {
    await action();
    return;
  }

  let successCount = 0;
  let confirmedByUi = false;
  const successes: string[] = [];

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error(`[upload-failed] ${label}: timed out waiting for ${expectedCount} bizmedia upload response(s), got ${successCount}.`));
    }, timeout);

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      page.off("response", onResponse);
      if (error) reject(error);
      else resolve();
    };

    const onResponse = (response: Response) => {
      if (!isBizmediaUploadResponse(response)) return;

      void readBizmediaUploadResponse(response).then((body) => {
        if (settled) return;
        const ret = body?.base_resp?.ret;
        const errMsg = body?.base_resp?.err_msg ?? "unknown";
        if (ret !== 0 || !body?.content) {
          finish(new Error(`[upload-failed] ${label}: bizmedia upload returned ret=${String(ret)} err_msg=${errMsg}.`));
          return;
        }

        successCount += 1;
        successes.push(body.content);
        if (successCount >= expectedCount) finish();
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        finish(new Error(`[upload-failed] ${label}: failed to parse bizmedia upload response: ${message}`));
      });
    };

    page.on("response", onResponse);
    void action()
      .then(async () => {
        if (!uiConfirmation) return;
        try {
          await uiConfirmation();
          confirmedByUi = true;
          console.log(`[upload-ui-ok] ${label}: visible upload state confirmed`);
          finish();
        } catch {
          console.warn(`[warn] ${label}: visible upload state not confirmed, keep waiting for bizmedia response`);
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        finish(new Error(`[upload-failed] ${label}: upload action failed: ${message}`));
      });
  });

  if (!confirmedByUi) {
    console.log(`[upload-api-ok] ${label}: ${successes.length} bizmedia response(s) confirmed`);
  }
}

export async function waitForUploadedFiles(page: Page, files: string[], label: string): Promise<void> {
  const fileNames = files.map((filePath) => path.basename(filePath));
  if (!fileNames.length) return;

  try {
    const imageTexts = page.locator("wujie-app .img_text");
    await imageTexts.first().waitFor({ state: "visible", timeout: 60000 });
    await Promise.all(fileNames.map(async (fileName) => {
      await imageTexts.filter({ hasText: fileName }).first().waitFor({ state: "visible", timeout: 60000 });
    }));
    console.log(`[upload-ok] ${label}: ${fileNames.join(", ")}`);
  } catch {
    console.warn(`[warn] upload result not confirmed for ${label}: ${fileNames.join(", ")}`);
  }
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

  const locator = page.locator(selector).nth(index);
  if (await locator.count() === 0) {
    console.warn(`[skip] selector not found for ${label}: ${selector} [${index}]`);
    return;
  }

  if (triggerSelector) {
    console.warn(`[warn] ${label}: trigger selector ignored, using input.setInputFiles directly`);
  }

  await waitForBizmediaUploadSuccesses(page, files.length, label, async () => {
    await locator.setInputFiles(files, { timeout: 10000 });
  });
  await waitForUploadedFiles(page, files, label);
  console.log(`[upload] ${label}: ${files.length} file(s)`);
}


export async function uploadInGroup(
  group: Locator,
  filePaths: Array<string | undefined>,
  label: string,
  resolveFromRoot: (filePath: string) => string,
  remoteDirectoryName?: string,
): Promise<void> {
  const files = await prepareUploadFiles(filePaths, resolveFromRoot, remoteDirectoryName);
  if (!files.length) {
    console.warn(`[skip] ${label}: no existing file`);
    return;
  }

  const input = group.locator('input[type="file"]').first();
  if (await input.count() === 0) {
    console.warn(`[skip] selector not found for ${label}`);
    return;
  }

  await waitForBizmediaUploadSuccesses(group.page(), files.length, label, async () => {
    await input.setInputFiles(files, { timeout: 10000 });
  });
  await waitForUploadedFiles(group.page(), files, label);
  console.log(`[upload] ${label}: ${files.length} file(s)`);
}

export async function setInputFilesByLocator(
  locator: Locator,
  files: string[],
  label: string,
  timeout = 60000,
): Promise<void> {
  if (!files.length) return;

  if (await locator.count() === 0) {
    throw new Error(`[upload-failed] ${label}: input[type=file] not found`);
  }

  await locator.first().setInputFiles(files, { timeout });
  console.log(`[upload] ${label}: ${files.length} file(s)`);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
