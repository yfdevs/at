import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import {
  MEITUAN_CREATION_LOGIN_URL,
  MEITUAN_CREATION_PUBLISH_VIDEO_URL
} from "../shared/constants.js";
import type {
  MeituanCreationCollectionSchema,
  MeituanCreationRuntime,
  MeituanCreationRuntimeOptions,
  MeituanCreationRuntimeStatus
} from "../shared/types.js";

const defaultCollection: MeituanCreationCollectionSchema = {
  type: "真人短剧（含AI）",
  subType: "真人短剧"
};

const collectionSubTypes: Record<MeituanCreationCollectionSchema["type"], MeituanCreationCollectionSchema["subType"][]> = {
  "真人短剧（含AI）": ["真人短剧", "AI真人短剧"],
  "动漫短剧": ["动态漫", "沙雕漫", "PPT漫"]
};

function log(options: MeituanCreationRuntimeOptions, message: string) {
  options.onLog?.(message);
}

function loginStateFromUrl(url: string): MeituanCreationRuntimeStatus["loginState"] {
  if (!url) return "unknown";
  return url.includes("/new/login") ? "login-required" : "logged-in";
}

async function isPublishFormReady(page: Page) {
  return page.getByText("发布至合集").isVisible({ timeout: 1500 }).catch(() => false);
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
  await page.waitForFunction(() => {
    const bodyText = document.body?.innerText ?? "";
    return !location.href.includes("/new/login") || bodyText.includes("发布至合集");
  }, undefined, { timeout: 10 * 60 * 1000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  log(options, "[meituan-creation] login completed");
}

async function saveCredentialState(context: BrowserContext, options: MeituanCreationRuntimeOptions) {
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
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

async function selectCollectionType(page: Page, options: MeituanCreationRuntimeOptions) {
  const collection = options.config?.collection ?? defaultCollection;
  const validSubTypes = collectionSubTypes[collection.type] ?? collectionSubTypes[defaultCollection.type];
  const subType = validSubTypes.includes(collection.subType) ? collection.subType : validSubTypes[0];
  const collectionTypeTextbox = page.getByRole("textbox", { name: "选择合集类型" });

  await page.waitForTimeout(500);
  await collectionTypeTextbox.waitFor({ state: "visible", timeout: 60_000 });
  await collectionTypeTextbox.click({ timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await clickWhenReady(page, page.getByText(collection.type));
  await clickWhenReady(page, page.getByText(subType, { exact: true }));
}

async function runPublishSkeleton(
  context: BrowserContext,
  page: Page,
  options: MeituanCreationRuntimeOptions
) {
  const authorNicknameText = options.config?.authorNicknameText?.trim() || "本人 明星说漫剧";

  log(options, "[meituan-creation] opening publish page");
  await page.goto(MEITUAN_CREATION_PUBLISH_VIDEO_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60_000
  });
  await waitForLogin(page, options);

  if (!page.url().includes("/new/publishVideo")) {
    await page.goto(MEITUAN_CREATION_PUBLISH_VIDEO_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000
    });
  }

  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  await page.getByText("发布至合集").waitFor({ state: "visible", timeout: 60_000 });
  await saveCredentialState(context, options);
  await clickWhenReady(page, page.getByText("发布至合集"));

  const authorTextbox = page.getByRole("textbox", { name: "请选择名下作者昵称" });
  await authorTextbox.waitFor({ state: "visible", timeout: 60_000 });
  await authorTextbox.click({ timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await authorTextbox.click({ timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await clickWhenReady(page, page.getByText(authorNicknameText));

  const collectionTextbox = page.getByRole("textbox", { name: "选择或创建合集" });
  await collectionTextbox.waitFor({ state: "visible", timeout: 60_000 });
  await collectionTextbox.click({ timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);

  const createCollection = page.locator("div").filter({ hasText: /^创建新合集$/ }).nth(2);
  await createCollection.waitFor({ state: "visible", timeout: 60_000 });
  await createCollection.click({ timeout: 30_000 });
  await selectCollectionType(page, options);
  log(options, "[meituan-creation] publish skeleton task completed");
}

export async function startMeituanCreationRuntime(
  options: MeituanCreationRuntimeOptions = {}
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
    slowMo: options.config?.browser?.slowMo ?? 20
  });
  page = context.pages()[0] ?? await context.newPage();

  await runPublishSkeleton(context, page, options);

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
        userDataDir
      };
    },
    async stop() {
      if (context) {
        await saveCredentialState(context, options).catch(() => undefined);
      }
      running = false;
      await context?.close();
      log(options, "[meituan-creation] runtime skeleton stopped");
    }
  };
}
