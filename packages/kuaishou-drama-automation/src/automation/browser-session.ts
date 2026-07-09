import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BrowserContext, Page } from "playwright";
import type {
  KuaishouDramaLoginState,
  KuaishouDramaRuntimeOptions,
} from "../shared/types.js";

export function log(options: KuaishouDramaRuntimeOptions, message: string) {
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

export function loginStateFromUrl(url: string | undefined): KuaishouDramaLoginState {
  if (!url || url === "about:blank") return "unknown";
  return url.includes("login") ? "login-required" : "logged-in";
}

async function writeLogFile(
  options: KuaishouDramaRuntimeOptions,
  level: "info" | "warn" | "error",
  message: string,
) {
  if (!options.logFilePath) {
    return;
  }

  const record = {
    time: formatChineseDateTime(new Date()),
    level,
    platform: "kuaishou-drama",
    accountProfileName: options.accountProfileName,
    message,
  };

  await mkdir(dirname(options.logFilePath), { recursive: true });
  await appendFile(options.logFilePath, `${JSON.stringify(record)}\n`, "utf8");
}

export async function cleanupOldLogFiles(options: KuaishouDramaRuntimeOptions) {
  if (!options.logFilePath) {
    return;
  }

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

export async function saveCredentialState(
  context: BrowserContext,
  options: KuaishouDramaRuntimeOptions,
) {
  if (!options.credentialStatePath) {
    return;
  }

  await mkdir(dirname(options.credentialStatePath), { recursive: true });
  await context.storageState({ path: options.credentialStatePath });
  log(options, `[kuaishou-drama] credential snapshot saved: ${options.credentialStatePath}`);
}

export async function waitForLoginIfNeeded(
  page: Page,
  options: KuaishouDramaRuntimeOptions,
): Promise<boolean> {
  if (loginStateFromUrl(page.url()) !== "login-required") {
    return false;
  }

  log(options, "[kuaishou-drama] login required, waiting for manual login");
  await page.waitForURL((url) => loginStateFromUrl(url.href) !== "login-required", {
    timeout: 10 * 60 * 1000,
  });
  await page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => undefined);
  log(options, "[kuaishou-drama] login completed");
  return true;
}
