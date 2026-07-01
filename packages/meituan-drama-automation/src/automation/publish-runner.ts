import type { BrowserContext, Page } from "playwright";
import { MEITUAN_CREATION_PUBLISH_VIDEO_URL } from "../shared/constants.js";
import type {
  MeituanCreationRuntimeOptions,
  MeituanCreationTaskConfig,
} from "../shared/types.js";
import {
  log,
  saveCredentialState,
  waitForLogin,
} from "./browser-session.js";
import { clickWhenReady } from "./form-controls.js";
import { uploadEpisodeVideosStep } from "./steps/episodes.js";
import { selectPublishTargetStep } from "./steps/select-author.js";
import { submitPublishStep } from "./steps/submit.js";

export async function runPublishTask(
  context: BrowserContext,
  page: Page,
  options: MeituanCreationRuntimeOptions,
  taskConfig: MeituanCreationTaskConfig | null,
) {
  log(options, "[meituan-drama] opening publish page");
  await page.goto(MEITUAN_CREATION_PUBLISH_VIDEO_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await waitForLogin(page, options);

  if (!page.url().includes("/new/publishVideo")) {
    await page.goto(MEITUAN_CREATION_PUBLISH_VIDEO_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
  }

  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  await page.getByText("发布至合集").waitFor({ state: "visible", timeout: 60_000 });
  await saveCredentialState(context, options);

  if (!taskConfig) {
    log(options, "[meituan-drama] task config not provided, browser is ready");
    return;
  }

  await clickWhenReady(page, page.getByText("发布至合集"));
  await selectPublishTargetStep(page, taskConfig, options);
  await uploadEpisodeVideosStep(page, taskConfig, options);
  await submitPublishStep(page, options);
  log(options, "[meituan-drama] publish task completed");
}
