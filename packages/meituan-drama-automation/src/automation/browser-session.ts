import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BrowserContext, Page } from "playwright";
import type {
  MeituanCreationLoginState,
  MeituanCreationRuntimeOptions,
} from "../shared/types.js";

export function log(options: MeituanCreationRuntimeOptions, message: string) {
  options.onLog?.(message);
  void writeLogFile(options, "info", message).catch(() => undefined);
}

function formatChineseDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
}

async function writeLogFile(
  options: MeituanCreationRuntimeOptions,
  level: "info" | "warn" | "error",
  message: string,
) {
  if (!options.logFilePath) return;

  const record = {
    time: formatChineseDateTime(new Date()),
    level,
    platform: "meituan-drama",
    message,
  };

  await mkdir(dirname(options.logFilePath), { recursive: true });
  await appendFile(options.logFilePath, `${JSON.stringify(record)}\n`, "utf8");
}

export async function cleanupOldLogFiles(options: MeituanCreationRuntimeOptions) {
  if (!options.logFilePath) return;

  const retentionDays = Math.max(1, options.logRetentionDays ?? 3);
  const logDir = dirname(options.logFilePath);
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  await mkdir(logDir, { recursive: true });

  for (const entry of await readdir(logDir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !/^app-\d{4}-\d{2}-\d{2}\.(?:jsonl|log)$/i.test(entry.name)) {
      continue;
    }

    const filePath = join(logDir, entry.name);
    const stats = await stat(filePath).catch(() => null);
    if (stats && stats.mtimeMs < cutoff) {
      await unlink(filePath).catch(() => undefined);
    }
  }
}

export function loginStateFromUrl(url: string): MeituanCreationLoginState {
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
    { timeout: 0 },
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
