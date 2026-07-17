import type { BrowserContext, Page } from "playwright";
import { QQ_DRAMA_ADD_URL, QQ_DRAMA_LOGIN_URL } from "../shared/constants.js";
import { log } from "../shared/logger.js";
import type { ClaimedQqDramaTask, QqDramaRuntimeOptions } from "../shared/types.js";
import {
  qqDramaLoginStateFromUrl,
  saveCredentialState,
  waitForLoginIfNeeded,
} from "./browser-session.js";
import { fillBasicInfoStep } from "./steps/basic-info.js";
import { confirmAndMaybeSubmitStep } from "./steps/confirm.js";
import { uploadEpisodeVideosStep } from "./steps/episodes.js";

export async function openQqDramaAddPage(
  page: Page,
  context: BrowserContext,
  options: QqDramaRuntimeOptions,
) {
  async function gotoAddPage() {
    await page.goto(QQ_DRAMA_ADD_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(1_000);
  }

  await gotoAddPage();
  if (qqDramaLoginStateFromUrl(page.url()) === "login-required") {
    await page.goto(QQ_DRAMA_LOGIN_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await waitForLoginIfNeeded(page, context, options);
    await gotoAddPage();
  }

  await saveCredentialState(context, options).catch(() => undefined);
}

export async function runQqDramaPublishTask(
  page: Page,
  context: BrowserContext,
  task: ClaimedQqDramaTask,
  options: QqDramaRuntimeOptions,
) {
  log(options, `[qq-drama] opening add page for accountTaskId=${task.accountTaskId}`);
  await openQqDramaAddPage(page, context, options);

  log(options, `[qq-drama] start basic info step: accountTaskId=${task.accountTaskId}`);
  await fillBasicInfoStep(page, task, options);

  log(options, `[qq-drama] start episode upload step: accountTaskId=${task.accountTaskId}`);
  await uploadEpisodeVideosStep(page, task, options);

  // oxlint-disable-next-line no-debugger
  debugger;

  log(options, `[qq-drama] start confirm step: accountTaskId=${task.accountTaskId}`);
  await confirmAndMaybeSubmitStep(page, task, options);

  await saveCredentialState(context, options).catch(() => undefined);
}
