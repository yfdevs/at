import { z } from "zod";
import { log } from "../shared/logger.js";
import {
  claimedQqDramaTaskSchema,
  type ClaimedQqDramaTask,
  type QqDramaApiConfig,
  type QqDramaRuntimeOptions,
  type QqDramaTaskFailStage,
  type QqDramaTaskStatus,
} from "../shared/types.js";
import { createQqDramaHttpClient, type QqDramaHttpClient } from "./http-client.js";

export type QqDramaTaskApiEndpoints = {
  accountTaskPage: string;
  claimTask: string;
  reportTask: string;
};

export type QqDramaTaskApiOptions = {
  apiConfig?: QqDramaApiConfig;
  client?: QqDramaHttpClient;
  endpoints?: Partial<QqDramaTaskApiEndpoints>;
};

export type ClaimNextQqDramaTaskOptions = QqDramaTaskApiOptions & {
  runtimeOptions?: QqDramaRuntimeOptions;
  rpaStatus?: QqDramaTaskStatus;
};

export type QqDramaTaskSuccessReport = QqDramaTaskApiOptions & {
  runtimeOptions?: QqDramaRuntimeOptions;
  accountTaskId: number;
  resultJson?: Record<string, unknown>;
  rpaStatus?: QqDramaTaskStatus;
};

export type QqDramaTaskErrorReport = QqDramaTaskApiOptions & {
  runtimeOptions?: QqDramaRuntimeOptions;
  accountTaskId: number;
  dramaId?: number;
  failStage: QqDramaTaskFailStage;
  errorMessage: string;
  resultJson?: Record<string, unknown>;
};

const defaultEndpoints: QqDramaTaskApiEndpoints = {
  accountTaskPage: "/dramaAiRpa/qq/accountTask/page",
  claimTask: "/dramaAiRpa/qq/rpa/claim",
  reportTask: "/dramaAiRpa/qq/rpa/report",
};
const readyTaskPageSize = 100;
const requiredText = z.string().trim().min(1);
const nullableText = z.string().nullish();
const jsonRecord = z.record(z.unknown());

const apiResponseBaseSchema = z.object({
  code: z.number(),
  msg: z.string().nullish(),
});

const readyAccountTaskSchema = z
  .object({
    id: z.coerce.number().int().positive(),
    dramaId: z.coerce.number().int().positive().optional(),
    accountId: requiredText,
    accountName: nullableText,
    status: nullableText,
    originalTitle: nullableText,
  })
  .passthrough();

const accountTaskPageResponseSchema = apiResponseBaseSchema.extend({
  data: z
    .object({
      total: z.coerce.number().int().nonnegative().optional(),
      data: z.array(readyAccountTaskSchema),
    })
    .nullish(),
});

const claimResponseDataSchema = z.object({
  accountTaskId: z.coerce.number().int().positive(),
  originalTitle: nullableText,
  accountId: nullableText,
  rpaProfileKey: nullableText,
  accountConfigJson: jsonRecord.nullish(),
  payloadJson: z.unknown(),
});

const claimResponseSchema = apiResponseBaseSchema.extend({
  data: claimResponseDataSchema.nullish(),
});

const reportResponseSchema = apiResponseBaseSchema.extend({
  data: z.boolean().nullish(),
});

type ReadyAccountTask = z.infer<typeof readyAccountTaskSchema>;
type ClaimResponseData = z.infer<typeof claimResponseDataSchema>;

function taskClient(options: QqDramaTaskApiOptions) {
  if (options.client) return options.client;
  if (!options.apiConfig?.baseUrl.trim()) {
    throw new Error("QQ_DRAMA_API_BASE_URL_REQUIRED");
  }
  return createQqDramaHttpClient(options.apiConfig);
}

function taskEndpoints(options: QqDramaTaskApiOptions): QqDramaTaskApiEndpoints {
  return { ...defaultEndpoints, ...options.endpoints };
}

function assertApiSuccess(payload: z.infer<typeof apiResponseBaseSchema>, action: string) {
  if (payload.code !== 0) {
    throw new Error(`${action}: code=${payload.code} message=${payload.msg || "-"}`);
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parsePayloadJson(value: unknown) {
  if (typeof value === "string") {
    return jsonRecord.parse(JSON.parse(value));
  }
  return jsonRecord.parse(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const normalized = stringValue(item);
    return normalized ? [normalized] : [];
  });
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function normalizeClaimedTask(options: {
  claimed: ClaimResponseData;
  listedTask?: ReadyAccountTask;
  runtimeOptions?: QqDramaRuntimeOptions;
}): ClaimedQqDramaTask {
  const { claimed, listedTask, runtimeOptions } = options;
  const expectedAccountId = runtimeOptions?.qqAccountId?.trim();
  const claimedAccountId = claimed.accountId?.trim();
  if (expectedAccountId && claimedAccountId && expectedAccountId !== claimedAccountId) {
    throw new Error(
      `QQ_DRAMA_CLAIMED_ACCOUNT_MISMATCH: expected=${expectedAccountId} actual=${claimedAccountId}`,
    );
  }

  const payload = parsePayloadJson(claimed.payloadJson);
  const playletPayload = recordValue(payload.qqPlaylet);
  const posters = recordValue(payload.posters);
  const copyright = recordValue(payload.copyright);
  const productionCost = recordValue(payload.productionCost);
  const licenseProofFiles = uniqueStrings([
    ...stringArray(playletPayload.licenseProofFiles),
    ...stringArray(copyright.licenseProofFiles),
  ]);
  const productionCostProofFiles = uniqueStrings(stringArray(productionCost.proofFiles));

  const playlet = {
    ...playletPayload,
    title: stringValue(playletPayload.title) ?? stringValue(payload.name),
    summary: stringValue(playletPayload.summary) ?? stringValue(payload.summary),
    coverImageFile: stringValue(playletPayload.coverImageFile),
    coverImageUrl:
      stringValue(playletPayload.coverImageUrl) ??
      stringValue(posters.main) ??
      stringValue(posters.promotion),
    episodeCount: numberValue(playletPayload.episodeCount) ?? numberValue(payload.episodeCount),
    baiduPanResourceLink:
      stringValue(playletPayload.baiduPanResourceLink) ??
      stringValue(payload.baiduPanResourceLink),
    productionOrganization:
      stringValue(playletPayload.productionOrganization) ?? stringValue(payload.producerName),
    productionCostWan:
      numberValue(playletPayload.productionCostWan) ?? numberValue(productionCost.amountWan),
    costAllocationReportFile:
      stringValue(playletPayload.costAllocationReportFile) ?? productionCostProofFiles[0],
    licenseProofFiles,
    submit: booleanValue(playletPayload.submit) ?? false,
  };

  const result = claimedQqDramaTaskSchema.safeParse({
    accountTaskId: claimed.accountTaskId,
    dramaId: listedTask?.dramaId,
    originalTitle: claimed.originalTitle ?? listedTask?.originalTitle,
    qqAccountId: claimedAccountId ?? listedTask?.accountId ?? expectedAccountId,
    qqAccountName: listedTask?.accountName ?? runtimeOptions?.qqAccountName,
    playlet,
  });
  if (result.success) return result.data;

  const details = result.error.issues
    .map((issue) => `${issue.path.join(".") || "task"}: ${issue.message}`)
    .join("; ");
  throw new Error(`QQ_DRAMA_CLAIMED_TASK_INVALID: ${details}`);
}

async function fetchReadyTasks(options: ClaimNextQqDramaTaskOptions) {
  const accountId = options.runtimeOptions?.qqAccountId?.trim();
  if (!accountId) {
    throw new Error("QQ_DRAMA_ACCOUNT_ID_REQUIRED");
  }
  const payload = accountTaskPageResponseSchema.parse(
    await taskClient(options).post(taskEndpoints(options).accountTaskPage, {
      page: 1,
      pageSize: readyTaskPageSize,
      dramaId: null,
      originalTitle: null,
      accountId,
      accountName: null,
      status: "READY",
      auditStatus: null,
    }),
  );
  assertApiSuccess(payload, "QQ_DRAMA_ACCOUNT_TASK_PAGE_FAILED");
  return (payload.data?.data ?? []).filter(
    (task) => task.accountId === accountId && task.status === "READY",
  );
}

async function claimTask(
  options: ClaimNextQqDramaTaskOptions,
  accountTaskId: number,
  listedTask?: ReadyAccountTask,
) {
  const payload = claimResponseSchema.parse(
    await taskClient(options).post(taskEndpoints(options).claimTask, { accountTaskId }),
  );
  assertApiSuccess(payload, "QQ_DRAMA_ACCOUNT_TASK_CLAIM_FAILED");
  if (!payload.data) return null;

  try {
    if (payload.data.accountTaskId !== accountTaskId) {
      throw new Error(
        `QQ_DRAMA_CLAIMED_TASK_ID_MISMATCH: expected=${accountTaskId} ` +
          `actual=${payload.data.accountTaskId}`,
      );
    }
    return normalizeClaimedTask({
      claimed: payload.data,
      listedTask,
      runtimeOptions: options.runtimeOptions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await reportQqDramaTask({
      ...options,
      taskId: payload.data.accountTaskId,
      success: false,
      failStage: "CLAIM_TASK",
      errorMessage: message,
      resultJson: {
        accountId: options.runtimeOptions?.qqAccountId,
        accountName: options.runtimeOptions?.qqAccountName,
      },
    }).catch((reportError) => {
      log(
        options.runtimeOptions ?? {},
        `[qq-drama] invalid claimed task report failed: accountTaskId=${payload.data?.accountTaskId} ` +
          `error=${reportError instanceof Error ? reportError.message : String(reportError)}`,
      );
    });
    throw error;
  }
}

// 按指定任务 ID 领取 QQ 上剧任务，用于人工指定或重试单个任务。
export async function claimQqDramaTaskByIdApi(
  options: ClaimNextQqDramaTaskOptions & { accountTaskId: number },
): Promise<ClaimedQqDramaTask | null> {
  return claimTask(options, options.accountTaskId);
}

// 查询当前账号的 READY 任务并逐条尝试领取，避免并发 worker 抢占时卡住队列。
export async function claimNextQqDramaTaskApi(
  options: ClaimNextQqDramaTaskOptions,
): Promise<ClaimedQqDramaTask | null> {
  const readyTasks = await fetchReadyTasks(options);
  if (readyTasks.length === 0) return null;

  log(
    options.runtimeOptions ?? {},
    `[qq-drama] fetched ${readyTasks.length} READY task(s)`,
  );
  for (const listedTask of readyTasks) {
    try {
      const claimed = await claimTask(options, listedTask.id, listedTask);
      if (claimed) return claimed;
    } catch (error) {
      log(
        options.runtimeOptions ?? {},
        `[qq-drama] task claim failed: accountTaskId=${listedTask.id} ` +
          `error=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return null;
}

async function reportQqDramaTask(
  report: QqDramaTaskApiOptions & {
    taskId: number;
    success: boolean;
    failStage?: QqDramaTaskFailStage;
    errorMessage?: string;
    resultJson?: Record<string, unknown>;
  },
) {
  const payload = reportResponseSchema.parse(
    await taskClient(report).post(taskEndpoints(report).reportTask, {
      taskId: report.taskId,
      success: report.success,
      failStage: report.failStage,
      errorMessage: report.errorMessage,
      resultJson: report.resultJson,
    }),
  );
  assertApiSuccess(payload, "QQ_DRAMA_ACCOUNT_TASK_REPORT_FAILED");
  if (payload.data === false) {
    throw new Error("QQ_DRAMA_ACCOUNT_TASK_REPORT_FAILED: data=false");
  }
}

export async function reportQqDramaTaskSuccessApi(report: QqDramaTaskSuccessReport): Promise<void> {
  await reportQqDramaTask({
    ...report,
    taskId: report.accountTaskId,
    success: true,
  });
}

export async function reportQqDramaTaskErrorApi(report: QqDramaTaskErrorReport): Promise<void> {
  await reportQqDramaTask({
    ...report,
    taskId: report.accountTaskId,
    success: false,
    failStage: report.failStage,
    errorMessage: report.errorMessage,
  });
}
