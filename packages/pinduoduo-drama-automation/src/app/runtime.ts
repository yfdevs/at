import type { BrowserContext, Page } from "playwright";
import {
  PINDUODUO_DRAMA_PLATFORM,
  PINDUODUO_LOGIN_EXPIRED_URL,
  PINDUODUO_SHORTPLAY_MANAGE_URL,
} from "../shared/constants.js";
import { cleanupOldLogFiles, log } from "../shared/logger.js";
import type {
  PinduoduoDramaRuntime,
  PinduoduoDramaRuntimeOptions,
  PinduoduoDramaRuntimeStatus,
} from "../shared/types.js";
import {
  launchPinduoduoBrowserContext,
  pinduoduoDramaLoginStateFromUrl,
  saveCredentialState,
} from "./browser-session.js";
import { openShortplayManagePage } from "./shortplay-manage-page.js";
import { claimAndSubmitNextTask } from "./task-runner.js";

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

  context = await launchPinduoduoBrowserContext(userDataDir, options, windowWidth, windowHeight);

  context.on("close", () => {
    running = false;
  });

  page = context.pages()[0] ?? (await context.newPage());
  let managePageReady = false;
  await openShortplayManagePage(page, context, options)
    .then(() => {
      managePageReady = true;
    })
    .catch((error: unknown) => {
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
