import type { Page } from "playwright";
import { log } from "../../shared/logger.js";
import type { ClaimedQqDramaTask, QqDramaRuntimeOptions } from "../../shared/types.js";
import { clickNextStep } from "./form-controls.js";

export async function confirmAndMaybeSubmitStep(
  page: Page,
  task: ClaimedQqDramaTask,
  options: QqDramaRuntimeOptions,
) {
  if (!task.playlet.submit) {
    log(options, `[qq-drama] task filled only: accountTaskId=${task.accountTaskId}`);
    return;
  }

  await clickNextStep(page, options, "提交审核");
}
