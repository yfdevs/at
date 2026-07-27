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
  // 账号任务列表分页查询接口
  accountTaskPage: "/dramaAiRpa/qq/accountTask/page",
  // 领取任务接口
  claimTask: "/dramaAiRpa/qq/rpa/claim",
  // 上报任务执行结果接口
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

function classifyClaimedTaskFailStage(error: unknown): QqDramaTaskFailStage {
  const message = error instanceof Error ? error.message : String(error);
  return /productionCost\.proofFiles|costAllocationReport|cover|poster|licenseProof|ownership|成本|封面|海报|权属|文件|素材/i.test(
    message,
  )
    ? "UPLOAD_FILE"
    : "OTHER";
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
  delete playletPayload.coverImageFile;
  delete playletPayload.coverImageUrl;
  delete playletPayload.posterImageUrl;
  const productionCost = recordValue(payload.productionCost);
  const productionCostProofFiles = uniqueStrings(stringArray(productionCost.proofFiles));

  const playlet = {
    ...playletPayload,
    title: stringValue(playletPayload.title) ?? stringValue(payload.name),
    summary: stringValue(playletPayload.summary) ?? stringValue(payload.summary),
    localCoverFile: undefined,
    episodeCount: numberValue(playletPayload.episodeCount) ?? numberValue(payload.episodeCount),
    baiduPanResourceLink:
      stringValue(playletPayload.baiduPanResourceLink) ?? stringValue(payload.baiduPanResourceLink),
    productionOrganization:
      stringValue(playletPayload.productionOrganization) ?? stringValue(payload.producerName),
    productionCostWan:
      numberValue(playletPayload.productionCostWan) ?? numberValue(productionCost.amountWan),
    costAllocationReportFiles: productionCostProofFiles,
    licenseProofFiles: [],
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
  // const taskPayload = await taskClient(options).post(taskEndpoints(options).claimTask, {
  //   accountTaskId,
  // });

  // 测试代码
  const taskPayload = {
    code: 0,
    msg: "操作成功",
    data: {
      accountTaskId: 3,
      originalTitle: "修鞋摊前的状元测试",
      accountId: "662687870288924672",
      rpaProfileKey: null,
      accountConfigJson: null,
      payloadJson: {
        name: "修鞋摊前的状元测试",
        posters: {
          main: "",
          promotion: "",
        },
        summary: "修鞋摊前的状元测试QQ修鞋摊前的状元测试QQ修鞋摊前的状元测试QQ修鞋摊前的状元测试QQ",
        platform: "qq",
        copyright: {
          licenseProofFiles: [],
          productionProofFiles: [],
        },
        qqPlaylet: {
          roles: [],
          title: "修鞋摊前的状元测试",
          submit: false,
          summary:
            "修鞋摊前的状元测试QQ修鞋摊前的状元测试QQ修鞋摊前的状元测试QQ修鞋摊前的状元测试QQ",
          isSeries: "否",
          comicType: "漫剧",
          directors: ["明星说（北京）科技有限公司"],
          producers: ["明星说（北京）科技有限公司"],
          audienceType: "男频",
          contractName: "【明星说漫剧】QQ漫剧协议（665599744810680320）",
          episodeCount: 12,
          updateStatus: "已完结",
          isAiGenerated: "是",
          screenwriters: ["明星说（北京）科技有限公司"],
          productionYear: 2026,
          primaryCategory: "都市",
          productionCostWan: 1,
          secondaryCategory: "都市日常",
          productionCostRange: "< 30 万",
          baiduPanResourceLink:
            "通过网盘分享的文件：修鞋摊前的状元测试\n链接: https://pan.baidu.com/s/1yTNaXlMXErFI48dBF5RVUQ?pwd=19r9 提取码: 19r9 \n--来自百度网盘超级会员v2的分享",
          productionOrganization: "明星说（北京）科技有限公司",
        },
        episodeCount: 64,
        producerName: "明星说（北京）科技有限公司",
        qualification: {
          type: "其他微短剧",
          proofFiles: [],
        },
        productionCost: {
          amountWan: 1,
          proofFiles: [
            "https://misu-launch-lianshan-beijing-final.tos-cn-beijing.volces.com/drama-ai-rpa/contracts/20260726/account-task-688-3d67f0a319af43ae942f579c2e32d7b4.png",
          ],
        },
        baiduPanResourceLink:
          "通过网盘分享的文件：修鞋摊前的状元测试\n链接: https://pan.baidu.com/s/1yTNaXlMXErFI48dBF5RVUQ?pwd=19r9 提取码: 19r9 \n--来自百度网盘超级会员v2的分享",
      },
    },
  };

  const payload = claimResponseSchema.parse(taskPayload);
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
    const failStage = classifyClaimedTaskFailStage(error);
    // oxlint-disable-next-line no-debugger
    debugger;
    await reportQqDramaTask({
      ...options,
      taskId: payload.data.accountTaskId,
      success: false,
      failStage,
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

  log(options.runtimeOptions ?? {}, `[qq-drama] fetched ${readyTasks.length} READY task(s)`);
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
  void report;
  // oxlint-disable-next-line no-debugger
  debugger;
  await reportQqDramaTask({
    ...report,
    taskId: report.accountTaskId,
    success: false,
    failStage: report.failStage,
    errorMessage: report.errorMessage,
  });
}
