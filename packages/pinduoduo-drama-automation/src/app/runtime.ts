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
import { pinduoduoTaskPollIntervalMs } from "../shared/polling.js";
import {
  launchPinduoduoBrowserContext,
  pinduoduoDramaLoginStateFromUrl,
  saveCredentialState,
} from "./browser-session.js";
import { openShortplayManagePage } from "./shortplay-manage-page.js";
import { claimAndSubmitNextTask } from "./task-runner.js";

const CHINA_TIME_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const TASK_POLL_NIGHT_START_HOUR = 0;
const TASK_POLL_NIGHT_END_HOUR = 8;

function nextTaskPollDelayMs(options: PinduoduoDramaRuntimeOptions, date = new Date()): number {
  const nextPoll = new Date(date.getTime() + pinduoduoTaskPollIntervalMs(options));
  const chinaDate = new Date(nextPoll.getTime() + CHINA_TIME_UTC_OFFSET_MS);
  const hour = chinaDate.getUTCHours();

  if (hour >= TASK_POLL_NIGHT_START_HOUR && hour < TASK_POLL_NIGHT_END_HOUR) {
    const nextChinaMorning = new Date(
      Date.UTC(
        chinaDate.getUTCFullYear(),
        chinaDate.getUTCMonth(),
        chinaDate.getUTCDate(),
        TASK_POLL_NIGHT_END_HOUR,
        0,
        0,
        0,
      ) - CHINA_TIME_UTC_OFFSET_MS,
    );
    return Math.max(1_000, nextChinaMorning.getTime() - date.getTime());
  }

  return Math.max(1_000, nextPoll.getTime() - date.getTime());
}

function formatChinaTimeIso(date: Date): string {
  const chinaDate = new Date(date.getTime() + CHINA_TIME_UTC_OFFSET_MS);
  return `${chinaDate.toISOString().replace("Z", "")}+08:00`;
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
  let taskLoopPromise: Promise<void> | null = null;
  let taskLoopTimer: ReturnType<typeof setTimeout> | null = null;
  let wakeTaskLoop: (() => void) | null = null;

  async function waitForNextTaskPoll(delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      wakeTaskLoop = resolve;
      taskLoopTimer = setTimeout(resolve, delayMs);
    });
    if (taskLoopTimer) {
      clearTimeout(taskLoopTimer);
      taskLoopTimer = null;
    }
    wakeTaskLoop = null;
  }

  function stopTaskLoopWait(): void {
    if (taskLoopTimer) {
      clearTimeout(taskLoopTimer);
      taskLoopTimer = null;
    }
    wakeTaskLoop?.();
    wakeTaskLoop = null;
  }

  async function runTaskLoop(activePage: Page): Promise<void> {
    while (running && !activePage.isClosed()) {
      await claimAndSubmitNextTask(activePage, options).catch((error: unknown) => {
        log(options, "error", "runtime", "failed to run pinduoduo drama task loop tick", {
          error,
        });
      });

      if (!running || activePage.isClosed()) {
        break;
      }

      const delayMs = nextTaskPollDelayMs(options);
      log(options, "info", "runtime", "pinduoduo drama task loop sleeping", {
        delayMs,
        nextPollAt: new Date(Date.now() + delayMs).toISOString(),
        nextPollAtChina: formatChinaTimeIso(new Date(Date.now() + delayMs)),
      });
      await waitForNextTaskPoll(delayMs);
    }
  }

  await cleanupOldLogFiles(options).catch(() => undefined);
  log(options, "info", "runtime", "starting browser", {
    userDataDir,
    accountProfileName: options.accountProfileName,
  });
  context = await launchPinduoduoBrowserContext(userDataDir, options);

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
    taskLoopPromise = runTaskLoop(page);
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
      running = false;
      stopTaskLoopWait();
      if (context) {
        await saveCredentialState(context, options).catch(() => undefined);
      }
      await context?.close();
      await taskLoopPromise?.catch(() => undefined);
      log(options, "info", "runtime", "runtime stopped");
    },
  };
}
