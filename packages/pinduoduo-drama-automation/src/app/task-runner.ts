import type { Page } from "playwright";
import { PINDUODUO_SHORTPLAY_APPLY_EDIT_URL } from "../shared/constants.js";
import {
  type ClaimNextPinduoduoDramaTaskOptions,
  claimNextPinduoduoDramaTaskApi,
  reportPinduoduoDramaTaskErrorApi,
  reportPinduoduoDramaTaskSuccessApi,
} from "../api/task.js";
import { log } from "../shared/logger.js";
import {
  pinduoduoDramaClaimedTaskSchema,
  type ClaimedPinduoduoDramaTask,
  type PinduoduoDramaRuntimeOptions,
} from "../shared/types.js";
import {
  PinduoduoApplyRecordsRepository,
  type PinduoduoTrackedApplyRecord,
} from "../storage/index.js";
import { uploadPinduoduoContractFiles } from "./contract-upload.js";
import {
  PinduoduoShortplayApplyEditError,
  submitPinduoduoShortplayApplyEdit,
} from "./shortplay-apply.js";
import {
  findSubmittedShortplayApplyRecord,
  refreshShortplayManagePendingList,
  selectShortplayManageRowByTitle,
  submitSelectedShortplaysForAudit,
} from "./shortplay-manage-page.js";

const VIDEO_RESOURCE_DOWNLOAD_RETRY_DELAY_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function claimOptions(
  options: PinduoduoDramaRuntimeOptions,
  rpaStatus: ClaimNextPinduoduoDramaTaskOptions["rpaStatus"],
): ClaimNextPinduoduoDramaTaskOptions {
  return {
    apiConfig: options.config?.api,
    pinduoduoAccountName: options.accountProfileName,
    rpaStatus,
  };
}

async function claimAndSubmitApplyTask(
  page: Page,
  options: PinduoduoDramaRuntimeOptions,
  applyRecordsRepository: PinduoduoApplyRecordsRepository,
): Promise<boolean> {
  const task = await claimNextPinduoduoDramaTaskApi(claimOptions(options, "READY"));
  if (!task) return false;

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
    await refreshShortplayManagePendingList(page, options, task.playlet.title).catch(
      (refreshError: unknown) => {
        log(options, "warn", "runtime", "failed to refresh shortplay manage pending list", {
          accountTaskId: task.accountTaskId,
          dramaId: task.dramaId,
          error: refreshError,
        });
      },
    );
    const selected = await selectShortplayManageRowByTitle(page, options, task.playlet.title);
    if (!selected) {
      throw new Error(`Pinduoduo submitted shortplay row was not selected: ${task.playlet.title}`);
    }

    await uploadPinduoduoContractFiles(page, options, task);
    await submitSelectedShortplaysForAudit(page, options);
    const submittedRecord = await findSubmittedShortplayApplyRecord(
      page,
      options,
      task.playlet.title,
    );
    applyRecordsRepository.upsertSubmittedRecord(task, submittedRecord);

    await reportPinduoduoDramaTaskSuccessApi({
      apiConfig: options.config?.api,
      accountTaskId: task.accountTaskId,
      resultJson: {
        auditStatus: "PENDING",
        platformApplyId: submittedRecord?.id,
        platformStatus: submittedRecord?.status,
        title: task.playlet.title,
      },
      rpaStatus: "AUDIT_PENDING",
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

  return true;
}

async function checkLocalAuditTask(
  page: Page,
  options: PinduoduoDramaRuntimeOptions,
  applyRecordsRepository: PinduoduoApplyRecordsRepository,
): Promise<boolean> {
  const trackedRecord = applyRecordsRepository.findDueAuditRecord();
  if (!trackedRecord) return false;

  try {
    const record = await findSubmittedShortplayApplyRecord(page, options, trackedRecord.title, {
      platformApplyId: trackedRecord.platformApplyId,
    });
    if (!record) {
      applyRecordsRepository.markAuditChecked(trackedRecord, "PENDING", null);
      await reportPinduoduoDramaTaskSuccessApi({
        apiConfig: options.config?.api,
        accountTaskId: trackedRecord.accountTaskId,
        resultJson: {
          auditStatus: "PENDING",
          message: "submitted shortplay record was not found in current submitted list page",
          platformApplyId: trackedRecord.platformApplyId,
          title: trackedRecord.title,
        },
        rpaStatus: "AUDIT_PENDING",
      });
      return true;
    }

    if (record.status === 3) {
      applyRecordsRepository.markAuditChecked(trackedRecord, "REJECTED", record);
      throw new Error(record.rejectReason || "Pinduoduo shortplay audit rejected.");
    }

    if (record.status === 1) {
      applyRecordsRepository.markAuditChecked(trackedRecord, "PENDING", record);
      await reportPinduoduoDramaTaskSuccessApi({
        apiConfig: options.config?.api,
        accountTaskId: trackedRecord.accountTaskId,
        resultJson: {
          auditStatus: "PENDING",
          platformApplyId: record.id,
          platformStatus: record.status,
          title: record.title,
        },
        rpaStatus: "AUDIT_PENDING",
      });
      return true;
    }

    applyRecordsRepository.markAuditChecked(trackedRecord, "APPROVED", record);
    await reportPinduoduoDramaTaskSuccessApi({
      apiConfig: options.config?.api,
      accountTaskId: trackedRecord.accountTaskId,
      resultJson: {
        auditStatus: "APPROVED",
        platformApplyId: record.id,
        platformStatus: record.status,
        title: record.title,
      },
      rpaStatus: "VIDEO_UPLOAD_READY",
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await reportPinduoduoDramaTaskErrorApi({
      apiConfig: options.config?.api,
      accountTaskId: trackedRecord.accountTaskId,
      dramaId: trackedRecord.dramaId,
      errorMessage,
      failStage: "CHECK_AUDIT",
      resultJson: {
        activeUrl: page.url(),
        platformApplyId: trackedRecord.platformApplyId,
        title: trackedRecord.title,
      },
    });
  }

  return true;
}

async function ensurePinduoduoVideoResourceReady(
  options: PinduoduoDramaRuntimeOptions,
  task: ClaimedPinduoduoDramaTask,
): Promise<void> {
  const shareText = task.playlet.demoUrl.trim();
  const localEpisodeVideoRoot = options.config?.video?.localEpisodeVideoRoot?.trim();
  if (!localEpisodeVideoRoot) {
    throw new Error("PINDUODUO_LOCAL_VIDEO_ROOT_REQUIRED");
  }
  if (!options.ensureBaiduNetdiskResource) {
    throw new Error("Pinduoduo video upload task requires Baidu Netdisk download integration.");
  }

  const retryAttempts = Math.max(
    0,
    Number.parseInt(String(options.config?.video?.baiduNetdiskDownloadRetryAttempts ?? 3), 10) || 3,
  );
  const maxAttempts = retryAttempts + 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await options.ensureBaiduNetdiskResource({
        episodeCount: task.playlet.episodeCount,
        localEpisodeVideoRoot,
        resourceName: task.originalTitle,
        shareText,
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      await sleep(VIDEO_RESOURCE_DOWNLOAD_RETRY_DELAY_MS);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function trackedRecordToTask(record: PinduoduoTrackedApplyRecord): ClaimedPinduoduoDramaTask {
  return pinduoduoDramaClaimedTaskSchema.parse({
    accountTaskId: record.accountTaskId,
    dramaId: record.dramaId,
    originalTitle: record.originalTitle,
    pinduoduoAccountId: record.pinduoduoAccountId,
    pinduoduoAccountName: record.pinduoduoAccountName,
    playlet: JSON.parse(record.payloadJson) as unknown,
  });
}

async function prepareLocalVideoResourceTask(
  options: PinduoduoDramaRuntimeOptions,
  applyRecordsRepository: PinduoduoApplyRecordsRepository,
): Promise<boolean> {
  const trackedRecord = applyRecordsRepository.findVideoReadyRecord();
  if (!trackedRecord) return false;

  const task = trackedRecordToTask(trackedRecord);

  try {
    await ensurePinduoduoVideoResourceReady(options, task);
    applyRecordsRepository.markVideoResourceReady(trackedRecord);
    await reportPinduoduoDramaTaskSuccessApi({
      apiConfig: options.config?.api,
      accountTaskId: task.accountTaskId,
      resultJson: {
        localEpisodeVideoRoot: options.config?.video?.localEpisodeVideoRoot,
        originalTitle: task.originalTitle,
        title: task.playlet.title,
        videoResourceStatus: "READY",
      },
      rpaStatus: "VIDEO_RESOURCE_READY",
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await reportPinduoduoDramaTaskErrorApi({
      apiConfig: options.config?.api,
      accountTaskId: task.accountTaskId,
      dramaId: task.dramaId,
      errorMessage,
      failStage: "PREPARE_VIDEO_RESOURCE",
      resultJson: {
        originalTitle: task.originalTitle,
        title: task.playlet.title,
      },
    });
  }

  return true;
}

export async function claimAndSubmitNextTask(
  page: Page,
  options: PinduoduoDramaRuntimeOptions,
): Promise<void> {
  const applyRecordsRepository = new PinduoduoApplyRecordsRepository(options);
  try {
    if (await claimAndSubmitApplyTask(page, options, applyRecordsRepository)) return;
    if (await checkLocalAuditTask(page, options, applyRecordsRepository)) return;
    if (await prepareLocalVideoResourceTask(options, applyRecordsRepository)) return;
  } finally {
    applyRecordsRepository.close();
  }

  log(options, "info", "runtime", "no pinduoduo drama task to run");
}
