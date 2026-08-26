import type { Page } from "playwright";
import { log } from "../../shared/logger.js";
import type { ClaimedQqDramaTask, QqDramaRuntimeOptions } from "../../shared/types.js";
import { clickNextStep, throwIfQqFormInvalid } from "./form-controls.js";

const submitSettleDelayMs = 10_000;

export async function confirmAndSubmitStep(
  page: Page,
  task: ClaimedQqDramaTask,
  options: QqDramaRuntimeOptions,
) {
  await page.waitForTimeout(800);
  await clickNextStep(page, options, "提交审核");
  await page.waitForTimeout(submitSettleDelayMs);
  await throwIfQqFormInvalid(page);
  log(options, `[qq-drama] review submitted: accountTaskId=${task.accountTaskId}`);
}
