import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import {
  type BrowserContext,
  type Page,
} from "playwright";
import {
  PINDUODUO_SHORTPLAY_APPLY_EDIT_URL,
  PINDUODUO_DRAMA_PLATFORM,
  PINDUODUO_LOGIN_EXPIRED_URL,
  PINDUODUO_MCN_ORIGIN,
  PINDUODUO_SHORTPLAY_MANAGE_URL,
} from "../shared/constants.js";
import {
  claimNextPinduoduoDramaTaskApi,
  reportPinduoduoDramaTaskErrorApi,
  reportPinduoduoDramaTaskSuccessApi,
} from "../api/task.js";
import {
  cleanupOldLogFiles,
  log,
} from "../shared/logger.js";
import type {
  PinduoduoDramaLoginState,
  PinduoduoDramaRuntime,
  PinduoduoDramaRuntimeOptions,
  PinduoduoDramaRuntimeStatus,
} from "../shared/types.js";
import {
  buildPinduoduoShortplayApplyEditRequest,
  PinduoduoShortplayApplyEditError,
  submitPinduoduoShortplayApplyEdit,
} from "./shortplay-apply.js";

chromium.use(StealthPlugin());

const LOGIN_REDIRECT_WAIT_MS = 10_000;

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

function maskNavigatorWebdriver(): void {
  const defineWebdriverGetter = (target: object | null | undefined) => {
    if (!target) {
      return;
    }

    try {
      Object.defineProperty(target, "webdriver", {
        configurable: true,
        get: () => false,
      });
    } catch {
      // Some browser objects reject direct redefinition; keep the other targets active.
    }
  };

  defineWebdriverGetter(Navigator.prototype);
  defineWebdriverGetter(Object.getPrototypeOf(navigator));
  defineWebdriverGetter(navigator);
}

async function waitForLoginStateAfterNavigation(page: Page): Promise<PinduoduoDramaLoginState> {
  let loginState = pinduoduoDramaLoginStateFromUrl(page.url());
  if (loginState === "login-required") {
    return loginState;
  }

  await page.waitForURL((url) => pinduoduoDramaLoginStateFromUrl(url.href) === "login-required", {
    timeout: LOGIN_REDIRECT_WAIT_MS,
  }).catch(() => undefined);

  loginState = pinduoduoDramaLoginStateFromUrl(page.url());
  return loginState;
}

async function waitForManualLoginAndOpenShortplayManagePage(
  page: Page,
  options: PinduoduoDramaRuntimeOptions,
): Promise<void> {
  log(options, "warn", "runtime", "waiting for manual login before claiming tasks", {
    activeUrl: page.url(),
    loginExpiredUrl: PINDUODUO_LOGIN_EXPIRED_URL,
  });

  while (!page.isClosed()) {
    await page.waitForURL((url) => pinduoduoDramaLoginStateFromUrl(url.href) === "logged-in", {
      timeout: 0,
    });

    log(options, "info", "runtime", "manual login detected, reopening shortplay manage page", {
      activeUrl: page.url(),
      manageUrl: PINDUODUO_SHORTPLAY_MANAGE_URL,
    });

    await page.goto(PINDUODUO_SHORTPLAY_MANAGE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    const loginState = await waitForLoginStateAfterNavigation(page);
    if (loginState === "logged-in") {
      log(options, "info", "runtime", "manual login completed, shortplay manage page reopened", {
        activeUrl: page.url(),
        loginState,
      });
      await saveCredentialState(page.context(), options).catch(() => undefined);
      return;
    }

    log(options, "warn", "runtime", "login is still required after reopening shortplay manage page", {
      activeUrl: page.url(),
      loginState,
    });
  }

  throw new Error("Pinduoduo browser page was closed while waiting for manual login.");
}

async function saveCredentialState(
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

async function openShortplayManagePage(
  page: Page,
  options: PinduoduoDramaRuntimeOptions,
): Promise<void> {
  log(options, "info", "runtime", "opening shortplay manage page", {
    url: PINDUODUO_SHORTPLAY_MANAGE_URL,
  });
  await page.goto(PINDUODUO_SHORTPLAY_MANAGE_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  const loginState = await waitForLoginStateAfterNavigation(page);
  if (loginState === "login-required") {
    log(options, "warn", "runtime", "login expired, redirected to register page", {
      activeUrl: page.url(),
      loginExpiredUrl: PINDUODUO_LOGIN_EXPIRED_URL,
    });
    await waitForManualLoginAndOpenShortplayManagePage(page, options);
    return;
  }

  log(options, "info", "runtime", "shortplay manage page opened", {
    activeUrl: page.url(),
    loginState,
  });
}

async function claimAndSubmitNextTask(
  page: Page,
  options: PinduoduoDramaRuntimeOptions,
): Promise<void> {
  const task = await claimNextPinduoduoDramaTaskApi({
    apiConfig: options.config?.api,
    pinduoduoAccountName: options.accountProfileName,
  });
  if (!task) {
    log(options, "info", "runtime", "no pinduoduo drama task to submit");
    return;
  }

  log(options, "info", "runtime", "claimed pinduoduo drama task, submitting shortplay apply edit", {
    accountTaskId: task.accountTaskId,
    dramaId: task.dramaId,
    title: task.playlet.title,
  });

  try {
    const requestBody = buildPinduoduoShortplayApplyEditRequest(task);
    log(options, "info", "runtime", "shortplay apply edit request", {
      accountTaskId: task.accountTaskId,
      dramaId: task.dramaId,
      url: PINDUODUO_SHORTPLAY_APPLY_EDIT_URL,
      body: requestBody,
      bodyJson: JSON.stringify(requestBody),
    });

    const response = await submitPinduoduoShortplayApplyEdit(page, task);
    log(options, "info", "runtime", "shortplay apply edit submitted", {
      accountTaskId: task.accountTaskId,
      dramaId: task.dramaId,
      response,
    });
    await reportPinduoduoDramaTaskSuccessApi({
      apiConfig: options.config?.api,
      accountTaskId: task.accountTaskId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(options, "error", "runtime", "failed to submit shortplay apply edit", {
      accountTaskId: task.accountTaskId,
      dramaId: task.dramaId,
      error,
    });
    await reportPinduoduoDramaTaskErrorApi({
      apiConfig: options.config?.api,
      accountTaskId: task.accountTaskId,
      dramaId: task.dramaId,
      failStage: "SUBMIT_SHORTPLAY",
      errorMessage,
      resultJson: {
        activeUrl: page.url(),
        applyEditResponse: error instanceof PinduoduoShortplayApplyEditError
          ? error.response
          : undefined,
      },
    }).catch((reportError: unknown) => {
      log(options, "error", "runtime", "failed to report shortplay apply edit error", {
        accountTaskId: task.accountTaskId,
        error: reportError,
      });
    });
  }
}

export async function startPinduoduoDramaRuntime(
  options: PinduoduoDramaRuntimeOptions = {},
): Promise<PinduoduoDramaRuntime> {
  if (!options.userDataDir) {
    throw new Error("Pinduoduo drama userDataDir is required.");
  }

  const userDataDir = options.userDataDir;
  let running = true;
  let page: Page | null = null;
  let context: BrowserContext | null = null;

  await cleanupOldLogFiles(options).catch(() => undefined);
  log(options, "info", "runtime", "starting browser", {
    userDataDir,
    accountProfileName: options.accountProfileName,
  });
  const windowWidth = Math.max(800, Math.floor(options.config?.browser?.windowWidth ?? 1440));
  const windowHeight = Math.max(600, Math.floor(options.config?.browser?.windowHeight ?? 960));

  context = await chromium.launchPersistentContext(userDataDir, {
    args: [
      "--disable-blink-features=AutomationControlled",
      "--window-position=0,0",
      `--window-size=${windowWidth},${windowHeight}`,
    ],
    headless: options.config?.browser?.headless ?? false,
    ignoreDefaultArgs: ["--enable-automation"],
    slowMo: options.config?.browser?.slowMo ?? 0,
    viewport: null,
  });
  context.on("close", () => {
    running = false;
  });

  await context.addInitScript(maskNavigatorWebdriver);

  page = context.pages()[0] ?? (await context.newPage());
  await page.evaluate(maskNavigatorWebdriver).catch(() => undefined);
  let managePageReady = false;
  await openShortplayManagePage(page, options).then(() => {
    managePageReady = true;
  }).catch((error: unknown) => {
    log(options, "error", "runtime", "failed to open shortplay manage page", {
      error,
    });
  });

  if (managePageReady) {
    await claimAndSubmitNextTask(page, options).catch((error: unknown) => {
      log(options, "error", "runtime", "failed to claim and submit pinduoduo drama task", {
        error,
      });
    });
  }

  return {
    getStatus(): PinduoduoDramaRuntimeStatus {
      const activeUrl = page?.url();
      return {
        platform: PINDUODUO_DRAMA_PLATFORM,
        running,
        loginState: pinduoduoDramaLoginStateFromUrl(activeUrl),
        activeUrl,
        manageUrl: PINDUODUO_SHORTPLAY_MANAGE_URL,
        loginExpiredUrl: PINDUODUO_LOGIN_EXPIRED_URL,
        userDataDir,
        accountProfileName: options.accountProfileName,
        accountDir: options.accountDir,
        credentialStatePath: options.credentialStatePath,
        logFilePath: options.logFilePath,
      };
    },
    async stop() {
      if (context) {
        await saveCredentialState(context, options).catch(() => undefined);
      }
      running = false;
      await context?.close();
      log(options, "info", "runtime", "runtime stopped");
    },
  };
}
