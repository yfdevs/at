import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { BrowserContext, Page } from "playwright";
import type {
  MeituanCreationRuntimeOptions,
  MeituanCreationRuntimeStatus,
} from "../shared/types.js";

export function log(options: MeituanCreationRuntimeOptions, message: string) {
  options.onLog?.(message);
}

export function loginStateFromUrl(url: string): MeituanCreationRuntimeStatus["loginState"] {
  if (!url) return "unknown";
  return url.includes("/new/login") ? "login-required" : "logged-in";
}

async function isPublishFormReady(page: Page) {
  return page
    .getByText("发布至合集")
    .isVisible({ timeout: 1500 })
    .catch(() => false);
}

export async function waitForLogin(page: Page, options: MeituanCreationRuntimeOptions) {
  if (await isPublishFormReady(page)) {
    log(options, "[meituan-drama] already logged in");
    return;
  }

  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  if (await isPublishFormReady(page)) {
    log(options, "[meituan-drama] already logged in");
    return;
  }

  if (!page.url().includes("/new/login")) {
    return;
  }

  log(options, "[meituan-drama] waiting for login");
  await page.waitForFunction(
    () => {
      const bodyText = document.body?.innerText ?? "";
      return !location.href.includes("/new/login") || bodyText.includes("发布至合集");
    },
    undefined,
    { timeout: 10 * 60 * 1000 },
  );
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  log(options, "[meituan-drama] login completed");
}

export async function saveCredentialState(
  context: BrowserContext,
  options: MeituanCreationRuntimeOptions,
) {
  if (!options.credentialStatePath) {
    return;
  }

  await mkdir(dirname(options.credentialStatePath), { recursive: true });
  await context.storageState({ path: options.credentialStatePath });
  log(options, `[meituan-drama] credential state saved: ${options.credentialStatePath}`);
}
