import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import {
  MEITUAN_CREATION_LOGIN_URL,
  MEITUAN_CREATION_PUBLISH_VIDEO_URL,
} from "../shared/constants.js";
import type {
  MeituanCreationConfig,
  MeituanCreationRuntime,
  MeituanCreationRuntimeOptions,
  MeituanCreationRuntimeStatus,
  MeituanCreationTaskConfig,
} from "../shared/types.js";
import { meituanCreationTaskSchema } from "../shared/types.js";

function log(options: MeituanCreationRuntimeOptions, message: string) {
  options.onLog?.(message);
}

function remoteFileExtension(url: URL, contentType: string | null) {
  const extension = extname(url.pathname);
  if (extension && extension.length <= 10) return extension;

  const extensionsByContentType: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
  };
  return extensionsByContentType[contentType?.split(";")[0].trim().toLowerCase() ?? ""] ?? ".bin";
}

function remoteFileName(url: URL, contentType: string | null) {
  const urlFileName = basename(url.pathname);
  if (urlFileName && urlFileName !== "." && urlFileName !== "/") return urlFileName;

  return `remote-cover${remoteFileExtension(url, contentType)}`;
}

async function downloadRemoteCover(coverUrl: string, options: MeituanCreationRuntimeOptions) {
  if (!options.assetDownloadDir) {
    throw new Error("MEITUAN_ASSET_DOWNLOAD_DIR_REQUIRED");
  }

  const url = new URL(coverUrl);
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 120_000);

  try {
    const response = await fetch(coverUrl, {
      redirect: "follow",
      signal: abortController.signal,
    });
    if (!response.ok) {
      throw new Error(`MEITUAN_COVER_DOWNLOAD_FAILED: HTTP ${response.status}: ${coverUrl}`);
    }

    const contentType = response.headers.get("content-type");
    const target = join(options.assetDownloadDir, remoteFileName(url, contentType));
    await mkdir(options.assetDownloadDir, { recursive: true });
    await writeFile(target, Buffer.from(await response.arrayBuffer()));
    log(options, `[meituan-creation] cover downloaded: ${target}`);
    return target;
  } catch (error) {
    if (abortController.signal.aborted) {
      throw Object.assign(new Error(`MEITUAN_COVER_DOWNLOAD_TIMEOUT: ${coverUrl}`), {
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function loginStateFromUrl(url: string): MeituanCreationRuntimeStatus["loginState"] {
  if (!url) return "unknown";
  return url.includes("/new/login") ? "login-required" : "logged-in";
}

async function isPublishFormReady(page: Page) {
  return page
    .getByText("发布至合集")
    .isVisible({ timeout: 1500 })
    .catch(() => false);
}

async function waitForLogin(page: Page, options: MeituanCreationRuntimeOptions) {
  if (await isPublishFormReady(page)) {
    log(options, "[meituan-creation] already logged in");
    return;
  }

  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  if (await isPublishFormReady(page)) {
    log(options, "[meituan-creation] already logged in");
    return;
  }

  if (!page.url().includes("/new/login")) {
    return;
  }

  log(options, "[meituan-creation] waiting for login");
  await page.waitForFunction(
    () => {
      const bodyText = document.body?.innerText ?? "";
      return !location.href.includes("/new/login") || bodyText.includes("发布至合集");
    },
    undefined,
    { timeout: 10 * 60 * 1000 },
  );
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  log(options, "[meituan-creation] login completed");
}

async function saveCredentialState(
  context: BrowserContext,
  options: MeituanCreationRuntimeOptions,
) {
  if (!options.credentialStatePath) {
    return;
  }

  await mkdir(dirname(options.credentialStatePath), { recursive: true });
  await context.storageState({ path: options.credentialStatePath });
  log(options, `[meituan-creation] credential state saved: ${options.credentialStatePath}`);
}

async function clickWhenReady(page: Page, locator: ReturnType<Page["getByText"]>) {
  await locator.waitFor({ state: "visible", timeout: 60_000 });
  await locator.click({ timeout: 30_000 });
  await page.waitForTimeout(300);
}

function hasTaskConfig(config: MeituanCreationConfig | undefined) {
  return Boolean(
    config?.authorNicknameText ||
    config?.audience ||
    config?.collectionType ||
    config?.collectionSubType ||
    config?.collectionTitle ||
    config?.collectionCoverUrl ||
    config?.backgroundText ||
    config?.storyThemeText ||
    config?.totalEpisodes ||
    config?.checkpointEpisodes,
  );
}

function parseTaskConfig(options: MeituanCreationRuntimeOptions): MeituanCreationTaskConfig | null {
  if (!hasTaskConfig(options.config)) {
    return null;
  }

  const result = meituanCreationTaskSchema.safeParse(options.config);

  if (result.success) {
    return result.data;
  }

  const details = result.error.issues
    .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
    .join("; ");
  throw new Error(`MEITUAN_TASK_CONFIG_INVALID: ${details}`);
}

async function uploadCollectionCover(
  page: Page,
  taskConfig: MeituanCreationTaskConfig,
  options: MeituanCreationRuntimeOptions,
) {
  const coverPath = await downloadRemoteCover(taskConfig.collectionCoverUrl, options);
  const uploadArea = page.getByRole("button", { name: "上传封面" }).locator("..");
  const coverInput = uploadArea.locator('input[type="file"]');

  await uploadArea.waitFor({ state: "visible", timeout: 60_000 });
  await coverInput.setInputFiles(coverPath, { timeout: 30_000 });
  await page.waitForTimeout(500);
}

async function confirmCoverUploadDialog(page: Page) {
  const confirmButton = page.locator("button").filter({ hasText: /^确定$/ }).last();

  await confirmButton.waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(300);
  await confirmButton.click({ timeout: 30_000 });
  await confirmButton.waitFor({ state: "hidden", timeout: 30_000 }).catch(() => undefined);
}

async function selectSingleTag(page: Page, triggerText: string, optionText: string) {
  await page.getByText(triggerText, { exact: true }).waitFor({ state: "visible", timeout: 60_000 });
  await page.getByText(triggerText, { exact: true }).click({ timeout: 30_000 });
  await page.waitForTimeout(300);
  await page.locator("div").filter({ hasText: new RegExp(`^${optionText}$`) }).last().click({ timeout: 30_000 });
  await page.waitForTimeout(300);
}

async function fillCollectionMetadata(page: Page, taskConfig: MeituanCreationTaskConfig) {
  await selectSingleTag(page, "请选择时代背景，最多可以选择1个", taskConfig.backgroundText);
  await selectSingleTag(page, "请选择故事主题，最多可以选择1个", taskConfig.storyThemeText);

  await page
    .getByRole("textbox", { name: "输入总集数" })
    .fill(String(taskConfig.totalEpisodes), { timeout: 30_000 });

  await page.getByText("请选择卡点集", { exact: true }).click({ timeout: 30_000 });
  await page.waitForTimeout(300);
  for (const episode of taskConfig.checkpointEpisodes) {
    await page.getByText(`第${episode}集`, { exact: true }).click({ timeout: 30_000 });
    await page.waitForTimeout(200);
  }
}

async function fillCreateCollectionDrawer(
  page: Page,
  taskConfig: MeituanCreationTaskConfig,
  options: MeituanCreationRuntimeOptions,
) {
  const collectionTypeTextbox = page.getByRole("textbox", { name: "选择合集类型" });
  const audienceTextbox = page.getByRole("textbox", { name: "请选择短漫剧受众" });
  const titleTextbox = page.getByRole("textbox", { name: "输入合集标题" });

  await page.waitForTimeout(500);
  await collectionTypeTextbox.waitFor({ state: "visible", timeout: 60_000 });
  await collectionTypeTextbox.click({ timeout: 30_000 });
  await clickWhenReady(page, page.getByText(taskConfig.collectionType));
  await clickWhenReady(page, page.getByText(taskConfig.collectionSubType, { exact: true }));

  await audienceTextbox.waitFor({ state: "visible", timeout: 60_000 });
  await audienceTextbox.click({ timeout: 30_000 });
  await clickWhenReady(page, page.getByText(taskConfig.audience));

  await titleTextbox.waitFor({ state: "visible", timeout: 60_000 });
  await titleTextbox.fill(taskConfig.collectionTitle, { timeout: 30_000 });

  await uploadCollectionCover(page, taskConfig, options);
  await confirmCoverUploadDialog(page);
  await fillCollectionMetadata(page, taskConfig);
}

async function runPublishSkeleton(
  context: BrowserContext,
  page: Page,
  options: MeituanCreationRuntimeOptions,
) {
  const taskConfig = parseTaskConfig(options);

  log(options, "[meituan-creation] opening publish page");
  await page.goto(MEITUAN_CREATION_PUBLISH_VIDEO_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await waitForLogin(page, options);

  if (!page.url().includes("/new/publishVideo")) {
    await page.goto(MEITUAN_CREATION_PUBLISH_VIDEO_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
  }

  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  await page.getByText("发布至合集").waitFor({ state: "visible", timeout: 60_000 });
  await saveCredentialState(context, options);

  if (!taskConfig) {
    log(options, "[meituan-creation] task config not provided, browser is ready");
    return;
  }

  await clickWhenReady(page, page.getByText("发布至合集"));

  const authorTextbox = page.getByRole("textbox", { name: "请选择名下作者昵称" });
  await authorTextbox.waitFor({ state: "visible", timeout: 60_000 });
  await authorTextbox.click({ timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await authorTextbox.click({ timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await clickWhenReady(page, page.getByText(taskConfig.authorNicknameText));

  const collectionTextbox = page.getByRole("textbox", { name: "选择或创建合集" });
  await collectionTextbox.waitFor({ state: "visible", timeout: 60_000 });
  await collectionTextbox.click({ timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);

  const createCollection = page
    .locator("div")
    .filter({ hasText: /^创建新合集$/ })
    .nth(2);
  await createCollection.waitFor({ state: "visible", timeout: 60_000 });
  await createCollection.click({ timeout: 30_000 });
  await fillCreateCollectionDrawer(page, taskConfig, options);
  log(options, "[meituan-creation] publish skeleton task completed");
}

export async function startMeituanCreationRuntime(
  options: MeituanCreationRuntimeOptions = {},
): Promise<MeituanCreationRuntime> {
  if (!options.userDataDir) {
    throw new Error("Meituan creation userDataDir is required.");
  }

  const userDataDir = options.userDataDir;
  let running = true;
  let page: Page | null = null;
  let context: BrowserContext | null = null;

  log(options, "[meituan-creation] starting browser");
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: options.config?.browser?.headless ?? false,
    slowMo: options.config?.browser?.slowMo ?? 20,
  });
  context.on("close", () => {
    running = false;
  });
  page = context.pages()[0] ?? (await context.newPage());

  void runPublishSkeleton(context, page, options).catch((error) => {
    log(
      options,
      `[meituan-creation] task failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  return {
    getStatus(): MeituanCreationRuntimeStatus {
      const activeUrl = page?.url();
      return {
        platform: "meituan-creation",
        loginUrl: MEITUAN_CREATION_LOGIN_URL,
        publishVideoUrl: MEITUAN_CREATION_PUBLISH_VIDEO_URL,
        running,
        loginState: activeUrl ? loginStateFromUrl(activeUrl) : "unknown",
        activeUrl,
        userDataDir,
      };
    },
    async stop() {
      if (context) {
        await saveCredentialState(context, options).catch(() => undefined);
      }
      running = false;
      await context?.close();
      log(options, "[meituan-creation] runtime skeleton stopped");
    },
  };
}
