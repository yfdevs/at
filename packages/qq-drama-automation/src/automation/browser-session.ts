import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { QQ_DRAMA_LOGIN_URL } from "../shared/constants.js";
import { log } from "../shared/logger.js";
import type { QqDramaLoginState, QqDramaRuntimeOptions } from "../shared/types.js";

export function qqDramaLoginStateFromUrl(url: string | undefined): QqDramaLoginState {
  if (!url || url === "about:blank") return "unknown";
  return /(?:#|\/)\/?login(?:\?|$|&|\/)/i.test(url) || url.includes("#/login")
    ? "login-required"
    : "logged-in";
}

function qqDramaBrowserLaunchOptions(options: QqDramaRuntimeOptions) {
  return {
    args: ["--disable-blink-features=AutomationControlled"],
    extraHTTPHeaders: {
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
    headless: options.config?.browser?.headless ?? false,
    ignoreDefaultArgs: ["--enable-automation"],
    locale: "zh-CN",
    slowMo: options.config?.browser?.slowMo ?? 0,
    timezoneId: "Asia/Shanghai",
    viewport: null,
  } satisfies Parameters<typeof chromium.launchPersistentContext>[1];
}

export async function launchQqDramaBrowserContext(
  userDataDir: string,
  options: QqDramaRuntimeOptions,
) {
  const launchOptions = qqDramaBrowserLaunchOptions(options);
  const context = await chromium.launchPersistentContext(userDataDir, launchOptions);
  log(options, "[qq-drama] started browser with Playwright Chromium");
  return context;
}

export async function saveCredentialState(context: BrowserContext, options: QqDramaRuntimeOptions) {
  if (!options.credentialStatePath) return;

  await mkdir(dirname(options.credentialStatePath), { recursive: true });
  await context.storageState({ path: options.credentialStatePath });
  log(options, `[qq-drama] credential snapshot saved: ${options.credentialStatePath}`);
}

export async function waitForLoginIfNeeded(
  page: Page,
  context: BrowserContext,
  options: QqDramaRuntimeOptions,
): Promise<boolean> {
  if (qqDramaLoginStateFromUrl(page.url()) !== "login-required") {
    return false;
  }

  log(options, "[qq-drama] login required, waiting for manual login");
  await page.bringToFront().catch(() => undefined);
  if (!page.url().includes("#/login")) {
    await page.goto(QQ_DRAMA_LOGIN_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
  }
  await page.waitForURL((url) => qqDramaLoginStateFromUrl(url.href) !== "login-required", {
    timeout: 120 * 60 * 1000,
  });
  await page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => undefined);
  await saveCredentialState(context, options).catch(() => undefined);
  log(options, "[qq-drama] login completed");
  return true;
}
