import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { BrowserContext, Page } from "playwright";
import { launchContext, maybePauseForInspection, saveStorageState, waitForLoginIfNeeded } from "./browser-session.js";
import { playletUrl } from "./constants.js";
import { fillBasicInfoStep } from "./steps/basic-info.js";
import { confirmAndMaybeSubmitStep } from "./steps/confirm.js";
import { uploadEpisodeFilesStep } from "./steps/episodes.js";
import { loadConfigFromDramaAiRpa, resolveRunDataPath } from "../shared/config.js";
import type { TaskRunOptions } from "../shared/types.js";
import { runWithLogContext } from "../shared/logger.js";
import { attachFailStage } from "../shared/errors.js";
import { getWechatVideoRuntimeSettings } from "../shared/runtime-settings.js";
import { booleanSetting, secondsSettingToMs } from "../shared/settings-value.js";

function shouldCloseFailedTaskPages(): boolean {
  return booleanSetting(getWechatVideoRuntimeSettings().closeFailedTaskPages);
}

function getBasicInfoStepTimeoutMs(): number {
  return secondsSettingToMs(getWechatVideoRuntimeSettings().basicInfoStepTimeoutSeconds, 600);
}

async function runStepWithTimeout<T>(
  name: string,
  timeoutMs: number,
  action: () => Promise<T>,
  onTimeout?: () => Promise<void> | void,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const actionPromise = action();
  const actionResult = actionPromise.then((value) => ({ type: "action" as const, value }));
  const timeoutPromise = new Promise<{ type: "timeout" }>((resolve) => {
    timer = setTimeout(() => {
      resolve({ type: "timeout" });
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([actionResult, timeoutPromise]);
    if (result.type === "timeout") {
      await onTimeout?.();
      void actionPromise.catch(() => undefined);
      throw new Error(`[step-timeout] ${name} exceeded ${Math.round(timeoutMs / 1000)}s`);
    }
    return result.value;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function closeTimedOutTaskPage(page: Page, stepName: string): Promise<void> {
  console.warn(`[step-timeout] closing task page to stop pending Playwright operations: ${stepName}`);
  await page.close({ runBeforeUnload: false }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[step-timeout] failed to close task page after ${stepName}: ${message}`);
  });
}

async function openManagedTaskPage(browserContext: BrowserContext): Promise<Page> {
  const previousPages = browserContext.pages();
  const page = await browserContext.newPage();
  if (shouldCloseFailedTaskPages()) {
    await Promise.all(previousPages.map((previousPage) => previousPage.close().catch(() => undefined)));
  } else if (previousPages.length > 0) {
    console.log(`[debug] Preserved ${previousPages.length} task page(s) because closeFailedTaskPages=false.`);
  }
  return page;
}

export async function runPlayletTask(runOptions: TaskRunOptions, managedBrowserContext?: BrowserContext): Promise<void> {
  return runWithLogContext({
    videoAccountId: runOptions.channelId,
    videoAccountName: runOptions.videoAccountName,
  }, () => runPlayletTaskInContext(runOptions, managedBrowserContext));
}

async function runPlayletTaskInContext(runOptions: TaskRunOptions, managedBrowserContext?: BrowserContext): Promise<void> {
  const playletConfig = runOptions.playletConfig ?? (runOptions.dramaAiRpaId
    ? await loadConfigFromDramaAiRpa(runOptions.dramaAiRpaId)
    : undefined);
  if (!playletConfig && (!managedBrowserContext || runOptions.mode === "run")) {
    throw new Error("playletConfig or dramaAiRpaId is required to start a run task.");
  }
  await mkdir(resolveRunDataPath(), { recursive: true });
  const standaloneUserDataDir = playletConfig?.browser?.userDataDir ?? ".auth/weixin-video-channel";
  const standaloneStateFile = path.join(standaloneUserDataDir, "storage-state.json");

  const ownsBrowserContext = managedBrowserContext === undefined;
  let browserContext: BrowserContext;
  if (managedBrowserContext) {
    browserContext = managedBrowserContext;
  } else {
    if (!playletConfig) {
      throw new Error("playletConfig or dramaAiRpaId is required to launch a standalone browser task.");
    }
    browserContext = await launchContext(playletConfig);
  }
  const page = ownsBrowserContext
    ? (browserContext.pages()[0] ?? await browserContext.newPage())
    : await openManagedTaskPage(browserContext);
  let failed = false;

  try {
    try {
      await page.goto(playletUrl, { waitUntil: "domcontentloaded" });
      const loggedIn = await waitForLoginIfNeeded(page);
      if (loggedIn && runOptions.channelId) {
        console.log(`[login] persisted videoAccountId=${runOptions.channelId}`);
      }
    } catch (error) {
      throw attachFailStage(error, "LOGIN");
    }
    if (ownsBrowserContext) await saveStorageState(browserContext, standaloneStateFile);

    if (runOptions.mode === "login") {
      return;
    }
    if (!playletConfig) {
      throw new Error("playletConfig or dramaAiRpaId is required to start a run task.");
    }

    console.log("[task] start fillBasicInfoStep");
    try {
      await runStepWithTimeout(
        "fillBasicInfoStep",
        getBasicInfoStepTimeoutMs(),
        () => fillBasicInfoStep(page, playletConfig),
        () => closeTimedOutTaskPage(page, "fillBasicInfoStep"),
      );
    } catch (error) {
      throw attachFailStage(error, "FILL_FORM");
    }
    console.log("[task] start uploadEpisodeFilesStep");
    try {
      await uploadEpisodeFilesStep(page, playletConfig, {
        videoAccountLabel: runOptions.channelId
          ? `videoAccountId=${runOptions.channelId} name=${runOptions.videoAccountName ?? runOptions.channelId}`
          : undefined,
      });
    } catch (error) {
      throw attachFailStage(error, "UPLOAD_FILE");
    }
    console.log("[task] start confirmAndMaybeSubmitStep");
    try {
      await confirmAndMaybeSubmitStep(page);
    } catch (error) {
      throw attachFailStage(error, "SUBMIT");
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (ownsBrowserContext) {
      await saveStorageState(browserContext, standaloneStateFile).catch(() => undefined);
      if (playletConfig) {
        await maybePauseForInspection(runOptions, playletConfig, failed);
      }
      await browserContext.close();
    } else {
      if (shouldCloseFailedTaskPages()) {
        console.log("[browser] Task page will be closed when the next task opens.");
      } else {
        console.log("[browser] Task page is kept open because closeFailedTaskPages=false.");
      }
    }
  }
}
