import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import {
  TAOBAO_DRAMA_BATCH_PUBLISH_URL,
  TAOBAO_DRAMA_COLLECTION_CREATE_URL,
  TAOBAO_DRAMA_PAGE_READY_RELOAD_MS,
} from "../shared/constants.js";
import { log } from "../shared/logger.js";
import type { TaobaoDramaLoginState, TaobaoDramaRuntimeOptions } from "../shared/types.js";

const loginHosts = ["login.taobao.com", "passport.taobao.com", "aq.taobao.com", "sec.taobao.com"];

export function taobaoLoginStateFromUrl(url?: string): TaobaoDramaLoginState {
  if (!url) return "unknown";
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "creator.guanghe.taobao.com") return "logged-in";
    if (parsed.hostname === "login.taobao.com" || parsed.hostname === "passport.taobao.com") {
      return "login-required";
    }
    if (loginHosts.includes(parsed.hostname)) return "verification-required";
  } catch {
    return "unknown";
  }
  return "unknown";
}

export function taobaoLoginStateFromPage(
  url: string | undefined,
  pageText: string,
): TaobaoDramaLoginState {
  const normalized = pageText.replace(/\s+/g, " ");
  if (/安全验证|身份验证|滑块验证|请完成验证|验证码|账号(?:存在)?风险|扫码验证/.test(normalized)) {
    return "verification-required";
  }
  if (/登录淘宝|手机扫码登录|密码登录|短信登录/.test(normalized)) {
    return "login-required";
  }
  return taobaoLoginStateFromUrl(url);
}

export function isTaobaoTargetUrl(url: string, target: "collection" | "batch") {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "creator.guanghe.taobao.com") return false;
    return target === "collection"
      ? parsed.pathname === "/page/unify/collect-create"
      : parsed.pathname === "/page/unify/creation-tool/batch-publish";
  } catch {
    return false;
  }
}

export function isTaobaoCreatorSuccessNavigation(
  url: string,
  target: "collection" | "batch",
) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "creator.guanghe.taobao.com" &&
      !/(?:^|\/)(?:error|login|verify|exception)(?:\/|$)/i.test(parsed.pathname) &&
      !isTaobaoTargetUrl(url, target);
  } catch {
    return false;
  }
}

async function targetReady(page: Page, target: "collection" | "batch") {
  const marker = page
    .getByText(target === "collection" ? /合集类型|短剧类型/ : /上传视频|上传文件|添加视频/)
    .filter({ visible: true })
    .first();
  const action = page
    .getByRole("button", { name: target === "collection" ? /创建合集|创建/ : /批量发布/ })
    .filter({ visible: true })
    .first();
  const markerReady = await marker.isVisible().catch(() => false) || (target === "batch" && await page
    .locator("input[type='file']:not([disabled])")
    .evaluateAll((inputs) => inputs.some((element) => {
      const input = element as HTMLInputElement;
      const context = input.parentElement?.parentElement?.textContent ?? "";
      return /video|mp4/i.test(input.accept) || /上传视频|添加视频|上传剧集/.test(context);
    }))
    .catch(() => false));
  if (target === "batch") return markerReady;
  return markerReady && await action.isVisible().catch(() => false);
}

async function currentLoginState(page: Page) {
  const text = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
  return taobaoLoginStateFromPage(page.url(), text);
}

export async function launchTaobaoBrowserContext(
  userDataDir: string,
  options: TaobaoDramaRuntimeOptions,
) {
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: options.config?.browser?.headless ?? false,
    slowMo: options.config?.browser?.slowMo ?? 0,
  });
  log(options, "[taobao-drama] Playwright Chromium 已启动");
  return context;
}

export async function saveTaobaoCredentialState(
  context: BrowserContext,
  options: TaobaoDramaRuntimeOptions,
) {
  if (!options.credentialStatePath) return;
  await mkdir(dirname(options.credentialStatePath), { recursive: true });
  await context.storageState({ path: options.credentialStatePath });
}

export async function waitForTaobaoPage(
  page: Page,
  target: "collection" | "batch",
  options: TaobaoDramaRuntimeOptions,
) {
  const targetUrl = target === "collection"
    ? TAOBAO_DRAMA_COLLECTION_CREATE_URL
    : TAOBAO_DRAMA_BATCH_PUBLISH_URL;
  if (!isTaobaoTargetUrl(page.url(), target)) {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  }

  let loginLogged = false;
  let lastReadyReloadAt = Date.now();
  while (!page.isClosed()) {
    const state = await currentLoginState(page);
    if (state === "login-required" || state === "verification-required") {
      if (!loginLogged) {
        log(
          options,
          state === "verification-required"
            ? "[taobao-drama] 等待用户完成淘宝安全校验"
            : "[taobao-drama] 等待用户登录淘宝光合平台",
        );
        loginLogged = true;
      }
      await page.waitForTimeout(1_000);
      continue;
    }

    if (!isTaobaoTargetUrl(page.url(), target)) {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      loginLogged = false;
      lastReadyReloadAt = Date.now();
      continue;
    }
    if (await targetReady(page, target)) {
      log(options, `[taobao-drama] ${target === "collection" ? "创建合集" : "批量发布"}页面已就绪`);
      return;
    }
    if (Date.now() - lastReadyReloadAt >= TAOBAO_DRAMA_PAGE_READY_RELOAD_MS) {
      log(
        options,
        `[taobao-drama] ${target === "collection" ? "创建合集" : "批量发布"}页面长时间未出现操作控件，刷新后重试`,
      );
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => undefined);
      lastReadyReloadAt = Date.now();
      continue;
    }
    await page.waitForTimeout(1_000);
  }
  throw new Error("TAOBAO_DRAMA_BROWSER_PAGE_CLOSED");
}
