import type { Page } from "playwright";
import { log } from "../../shared/logger.js";
import type { ClaimedQqDramaTask, QqDramaRuntimeOptions } from "../../shared/types.js";
import { clickNextStep } from "./form-controls.js";

export async function confirmAndSubmitStep(
  page: Page,
  task: ClaimedQqDramaTask,
  options: QqDramaRuntimeOptions,
) {
  await page.waitForTimeout(800);
  await clickNextStep(page, options, "提交审核");
  log(options, `[qq-drama] review submitted: accountTaskId=${task.accountTaskId}`);
}
