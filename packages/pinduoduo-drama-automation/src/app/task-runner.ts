import type { Page } from "playwright";
import { PINDUODUO_SHORTPLAY_APPLY_EDIT_URL } from "../shared/constants.js";
import {
  claimNextPinduoduoDramaTaskApi,
  reportPinduoduoDramaTaskErrorApi,
  reportPinduoduoDramaTaskSuccessApi,
} from "../api/task.js";
import { log } from "../shared/logger.js";
import type { PinduoduoDramaRuntimeOptions } from "../shared/types.js";
import {
  PinduoduoShortplayApplyEditError,
  submitPinduoduoShortplayApplyEdit,
} from "./shortplay-apply.js";
import { refreshShortplayManagePendingList } from "./shortplay-manage-page.js";

export async function claimAndSubmitNextTask(
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
    log(options, "info", "runtime", "shortplay apply edit request", {
      accountTaskId: task.accountTaskId,
      dramaId: task.dramaId,
      title: task.playlet.title,
      url: PINDUODUO_SHORTPLAY_APPLY_EDIT_URL,
    });

    const response = await submitPinduoduoShortplayApplyEdit(page, task);
    log(options, "info", "runtime", "shortplay apply edit submitted", {
      accountTaskId: task.accountTaskId,
      dramaId: task.dramaId,
      response,
    });
    await refreshShortplayManagePendingList(page, options).catch((refreshError: unknown) => {
      log(options, "warn", "runtime", "failed to refresh shortplay manage pending list", {
        accountTaskId: task.accountTaskId,
        dramaId: task.dramaId,
        error: refreshError,
      });
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
        applyEditResponse:
          error instanceof PinduoduoShortplayApplyEditError ? error.response : undefined,
      },
    }).catch((reportError: unknown) => {
      log(options, "error", "runtime", "failed to report shortplay apply edit error", {
        accountTaskId: task.accountTaskId,
        error: reportError,
      });
    });
  }
}
