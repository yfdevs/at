import { execFile } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import path, { dirname } from "node:path";
import { promisify } from "node:util";
import { chromium, type BrowserContext, type Page } from "playwright";
import { QQ_DRAMA_LOGIN_URL } from "../shared/constants.js";
import { log } from "../shared/logger.js";
import type { QqDramaLoginState, QqDramaRuntimeOptions } from "../shared/types.js";

const execFileAsync = promisify(execFile);

export function qqDramaLoginStateFromUrl(url: string | undefined): QqDramaLoginState {
  if (!url || url === "about:blank") return "unknown";
  return /(?:#|\/)\/?login(?:\?|$|&|\/)/i.test(url) || url.includes("#/login")
    ? "login-required"
    : "logged-in";
}

async function pathExists(filePath: string) {
  return access(filePath).then(
    () => true,
    () => false,
  );
}

function isChromeForTestingPath(filePath: string) {
  const normalizedPath = filePath.toLowerCase();
  return normalizedPath.includes("chrome for testing") || normalizedPath.includes("ms-playwright");
}

async function queryWindowsChromeAppPath(root: "HKCU" | "HKLM") {
  const key = `${root}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe`;
  const { stdout } = await execFileAsync("reg", ["query", key, "/ve"], {
    windowsHide: true,
  });
  const match = stdout.match(/REG_SZ\s+(.+chrome\.exe)\s*$/im);
  return match?.[1]?.trim();
}

async function findWindowsChromeExecutable() {
  const registryCandidates = await Promise.all([
    queryWindowsChromeAppPath("HKCU").catch(() => undefined),
    queryWindowsChromeAppPath("HKLM").catch(() => undefined),
  ]);
  const pathCandidates = [
    process.env.PROGRAMFILES
      ? path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe")
      : undefined,
    process.env["PROGRAMFILES(X86)"]
      ? path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe")
      : undefined,
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
      : undefined,
  ];
  const candidates = [...registryCandidates, ...pathCandidates].filter(
    (candidate): candidate is string => Boolean(candidate?.trim()),
  );

  for (const candidate of candidates) {
    if (isChromeForTestingPath(candidate)) continue;
    if (await pathExists(candidate)) return candidate;
  }

  return undefined;
}

async function findLocalGoogleChromeExecutable() {
  const executablePath =
    process.platform === "win32"
      ? await findWindowsChromeExecutable()
      : process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : "/usr/bin/google-chrome";

  if (
    executablePath &&
    !isChromeForTestingPath(executablePath) &&
    (await pathExists(executablePath))
  ) {
    return executablePath;
  }

  throw new Error("QQ 短剧需要本机正式版 Google Chrome。请安装 Google Chrome 后再启动服务。");
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

  try {
    const executablePath = await findLocalGoogleChromeExecutable();
    const context = await chromium.launchPersistentContext(userDataDir, {
      ...launchOptions,
      executablePath,
    });
    log(options, `[qq-drama] started browser with local Google Chrome: ${executablePath}`);
    return context;
  } catch (error) {
    log(options, "[qq-drama] failed to start local Google Chrome");
    throw Object.assign(
      new Error("QQ 短剧需要本机正式版 Google Chrome。请安装 Google Chrome 后再启动服务。"),
      { cause: error },
    );
  }
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
