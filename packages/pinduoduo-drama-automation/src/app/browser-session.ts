import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium, type BrowserContext } from "playwright";
import { PINDUODUO_LOGIN_EXPIRED_URL, PINDUODUO_MCN_ORIGIN } from "../shared/constants.js";
import { log } from "../shared/logger.js";
import type { PinduoduoDramaLoginState, PinduoduoDramaRuntimeOptions } from "../shared/types.js";

function pinduoduoBrowserLaunchOptions(
  options: PinduoduoDramaRuntimeOptions,
  windowWidth: number,
  windowHeight: number,
) {
  return {
    args: [
      "--disable-blink-features=AutomationControlled",
      "--window-position=0,0",
      `--window-size=${windowWidth},${windowHeight}`,
    ],
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

export async function launchPinduoduoBrowserContext(
  userDataDir: string,
  options: PinduoduoDramaRuntimeOptions,
  windowWidth: number,
  windowHeight: number,
): Promise<BrowserContext> {
  const launchOptions = pinduoduoBrowserLaunchOptions(options, windowWidth, windowHeight);

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      ...launchOptions,
      channel: "chrome",
    });
    log(options, "info", "runtime", "started browser with Google Chrome channel");
    return context;
  } catch (error) {
    log(options, "error", "runtime", "failed to start Google Chrome channel", {
      error,
    });
    throw Object.assign(
      new Error(
        "Pinduoduo drama requires local Google Chrome. Install Google Chrome or repair the Chrome installation, then restart the service.",
      ),
      { cause: error },
    );
  }
}

export function pinduoduoDramaLoginStateFromUrl(url: string | undefined): PinduoduoDramaLoginState {
  if (!url || url === "about:blank") {
    return "unknown";
  }

  if (url.startsWith(PINDUODUO_LOGIN_EXPIRED_URL) || url.includes("/register")) {
    return "login-required";
  }

  if (url.startsWith(PINDUODUO_MCN_ORIGIN)) {
    return "logged-in";
  }

  return "unknown";
}

export async function saveCredentialState(
  context: BrowserContext,
  options: PinduoduoDramaRuntimeOptions,
): Promise<void> {
  if (!options.credentialStatePath) {
    return;
  }

  await mkdir(dirname(options.credentialStatePath), { recursive: true });
  await context.storageState({ path: options.credentialStatePath });
  log(options, "info", "runtime", "credential snapshot saved", {
    credentialStatePath: options.credentialStatePath,
  });
}
