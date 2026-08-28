import { z } from "zod";

import { log } from "../shared/logger.js";
import {
  claimedIqiyiDramaTaskSchema,
  type ClaimedIqiyiDramaTask,
  type IqiyiDramaApiConfig,
  type IqiyiDramaRuntimeOptions,
  type IqiyiDramaTaskFailStage,
  type IqiyiDramaTaskStatus,
  type IqiyiDramaType,
} from "../shared/types.js";
import { createIqiyiDramaHttpClient, type IqiyiDramaHttpClient } from "./http-client.js";

export type IqiyiDramaTaskApiEndpoints = {
  accountTaskPage: string;
  claimTask: string;
  reportTask: string;
};

type TaskApiOptions = {
  apiConfig?: IqiyiDramaApiConfig;
  client?: IqiyiDramaHttpClient;
  endpoints?: Partial<IqiyiDramaTaskApiEndpoints>;
};

export type ClaimNextIqiyiDramaTaskOptions = TaskApiOptions & {
  runtimeOptions?: IqiyiDramaRuntimeOptions;
  rpaStatus?: IqiyiDramaTaskStatus;
};

export type IqiyiDramaTaskSuccessReport = TaskApiOptions & {
  runtimeOptions?: IqiyiDramaRuntimeOptions;
  accountTaskId: number;
  resultJson?: Record<string, unknown>;
};

export type IqiyiDramaTaskErrorReport = TaskApiOptions & {
  runtimeOptions?: IqiyiDramaRuntimeOptions;
  accountTaskId: number;
  failStage: IqiyiDramaTaskFailStage;
  errorMessage: string;
  resultJson?: Record<string, unknown>;
};

const endpoints: IqiyiDramaTaskApiEndpoints = {
  accountTaskPage: "/dramaAiRpa/iqiyi/accountTask/page",
  claimTask: "/dramaAiRpa/iqiyi/rpa/claim",
  reportTask: "/dramaAiRpa/iqiyi/rpa/report",
};
const apiBaseSchema = z.object({ code: z.number(), msg: z.string().nullish() });
const readyTaskSchema = z.object({
  id: z.coerce.number().int().positive(),
  dramaId: z.coerce.number().int().positive().optional(),
  accountId: z.string().trim().min(1),
  accountName: z.string().nullish(),
  status: z.string().nullish(),
  originalTitle: z.string().nullish(),
}).passthrough();
const readyPageSchema = apiBaseSchema.extend({
  data: z.object({
    total: z.coerce.number().int().nonnegative().optional(),
    data: z.array(readyTaskSchema),
  }).nullish(),
});
const claimDataSchema = z.object({
  accountTaskId: z.coerce.number().int().positive(),
  originalTitle: z.string().nullish(),
  accountId: z.string().nullish(),
  payloadJson: z.unknown(),
});
const claimSchema = apiBaseSchema.extend({ data: claimDataSchema.nullish() });
const reportSchema = apiBaseSchema.extend({ data: z.boolean().nullish() });

type ReadyTask = z.infer<typeof readyTaskSchema>;
type ClaimData = z.infer<typeof claimDataSchema>;

function client(options: TaskApiOptions) {
  if (options.client) return options.client;
  if (!options.apiConfig?.baseUrl.trim()) throw new Error("IQIYI_DRAMA_API_BASE_URL_REQUIRED");
  return createIqiyiDramaHttpClient(options.apiConfig);
}

function resolvedEndpoints(options: TaskApiOptions) {
  return { ...endpoints, ...options.endpoints };
}

function assertSuccess(payload: z.infer<typeof apiBaseSchema>, action: string) {
  if (payload.code !== 0) {
    throw new Error(`${action}: code=${payload.code} message=${payload.msg || "-"}`);
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseJson(value: unknown) {
  return record(typeof value === "string" ? JSON.parse(value) : value);
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanValue(value: unknown) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return undefined;
}

function aiGeneratedValue(value: unknown) {
  if (value === true || value === 1 || value === "1") return "是" as const;
  if (value === false || value === 0 || value === "0") return "否" as const;
  const normalized = text(value)?.replace(/\s+/g, "");
  if (normalized === "是" || normalized === "含AI生成内容" || normalized === "AI生成") {
    return "是" as const;
  }
  if (normalized === "否" || normalized === "无需声明" || normalized === "非AI生成") {
    return "否" as const;
  }
  return undefined;
}

function shortDescription(value: unknown, titleValue: unknown) {
  const provided = text(value);
  if (provided) return Array.from(provided).slice(0, 10).join("");
  const title = text(titleValue) ?? "精彩剧集";
  const derived = Array.from(title).slice(0, 10).join("");
  return Array.from(derived).length >= 4
    ? derived
    : Array.from(`${derived}精彩推荐`).slice(0, 10).join("");
}

function texts(value: unknown) {
  if (Array.isArray(value)) return value.flatMap((item) => text(item) ? [text(item)!] : []);
  const normalized = text(value);
  return normalized ? normalized.split(/[,，、;；]/).map((item) => item.trim()).filter(Boolean) : [];
}

function unique(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function dramaType(value: unknown, payload: Record<string, unknown>): IqiyiDramaType {
  const normalized = text(value)?.toLowerCase().replace(/[\s_]/g, "-");
  if (
    normalized === "comic-drama"
    || normalized === "comic"
    || normalized === "comicplay"
    || normalized === "漫剧"
    || normalized === "动漫短剧"
  ) return "comic-drama";
  if (
    normalized === "short-drama"
    || normalized === "short"
    || normalized === "miniplay"
    || normalized === "短剧"
    || normalized === "真人短剧"
  ) return "short-drama";
  return payload.comicPlay || payload.comicType || payload.animationType
    ? "comic-drama"
    : "short-drama";
}

function normalizeClaimedTask(
  claimed: ClaimData,
  listed: ReadyTask | undefined,
  runtimeOptions: IqiyiDramaRuntimeOptions | undefined,
): ClaimedIqiyiDramaTask {
  const expectedAccountId = runtimeOptions?.iqiyiAccountId?.trim();
  const claimedAccountId = claimed.accountId?.trim();
  if (expectedAccountId && claimedAccountId && expectedAccountId !== claimedAccountId) {
    throw new Error(
      `IQIYI_DRAMA_CLAIMED_ACCOUNT_MISMATCH: expected=${expectedAccountId} actual=${claimedAccountId}`,
    );
  }

  const payload = parseJson(claimed.payloadJson);
  const playlet = {
    ...payload,
    ...record(payload.playlet),
    ...record(payload.iqiyiPlaylet),
    ...record(payload.iqiyiExtraInfo),
  };
  const covers = record(payload.cover);
  const copyright = record(payload.copyright);
  const productionCost = record(playlet.productionCost ?? payload.productionCost);
  const resolvedTitle = text(playlet.title) ?? text(playlet.name) ?? text(payload.name);
  const result = claimedIqiyiDramaTaskSchema.safeParse({
    accountTaskId: claimed.accountTaskId,
    dramaId: listed?.dramaId,
    originalTitle: claimed.originalTitle ?? listed?.originalTitle ?? payload.originalTitle,
    iqiyiAccountId: claimedAccountId ?? listed?.accountId ?? expectedAccountId,
    iqiyiAccountName: listed?.accountName ?? runtimeOptions?.iqiyiAccountName,
    playlet: {
      ...playlet,
      dramaType: dramaType(
        playlet.dramaType ?? playlet.projectType ?? playlet.contentType ?? payload.dramaType,
        playlet,
      ),
      title: resolvedTitle,
      shortDescription: shortDescription(
        playlet.shortDescription
          ?? playlet.recommendation
          ?? playlet.oneSentenceRecommendation
          ?? payload.recommendation,
        resolvedTitle,
      ),
      summary: text(playlet.summary)
        ?? text(playlet.plotSynopsisText)
        ?? text(payload.summary)
        ?? text(payload.introduction),
      episodeCount: numberValue(playlet.episodeCount)
        ?? numberValue(playlet.totalEpisodes)
        ?? numberValue(payload.episodeCount),
      baiduPanResourceLink: text(playlet.baiduPanResourceLink)
        ?? text(payload.baiduPanResourceLink),
      verticalCoverFile: text(playlet.verticalCoverFile)
        ?? text(playlet.portraitCoverFile)
        ?? text(covers.vertical)
        ?? text(covers.portrait),
      horizontalCoverFile: text(playlet.horizontalCoverFile)
        ?? text(playlet.landscapeCoverFile)
        ?? text(covers.horizontal)
        ?? text(covers.landscape),
      ownershipFiles: unique([
        ...texts(playlet.ownershipFiles),
        ...texts(playlet.copyrightFiles),
        ...texts(copyright.ownershipFiles),
        ...texts(copyright.productionProofFiles),
        ...texts(copyright.licenseProofFiles),
      ]),
      secondaryCategories: texts(
        playlet.secondaryCategories ?? playlet.tags ?? playlet.categoryTags,
      ),
      producers: texts(playlet.producers ?? playlet.producerNames),
      directors: texts(playlet.directors ?? playlet.directorNames),
      screenwriters: texts(playlet.screenwriters ?? playlet.screenwriterNames),
      actors: texts(playlet.actors ?? playlet.actorNames),
      productionOrganization: text(playlet.productionOrganization)
        ?? text(playlet.productionCompanyText)
        ?? text(playlet.publisherName)
        ?? text(playlet.issuerName)
        ?? text(payload.producerName),
      productionCostYuan: numberValue(playlet.productionCostYuan)
        ?? numberValue(playlet.costYuan)
        ?? numberValue(productionCost.amountYuan)
        ?? (() => {
          const amountWan = numberValue(playlet.productionCostWan)
            ?? numberValue(productionCost.amountWan);
          return amountWan === undefined ? undefined : amountWan * 10_000;
        })(),
      scheduledOnlineTime: text(playlet.scheduledOnlineTime)
        ?? text(playlet.onlineTime)
        ?? text(playlet.publishOnlineTime),
      releaseDate: text(playlet.releaseDate)
        ?? text(playlet.publishDate)
        ?? text(playlet.issueDate),
      productionYear: numberValue(playlet.productionYear ?? playlet.year),
      isAiGenerated: aiGeneratedValue(
        playlet.isAiGenerated ?? playlet.aiGenerated ?? playlet.uploadStatement,
      ),
      submit: booleanValue(playlet.submit) ?? true,
    },
  });
  if (result.success) return result.data;
  throw new Error(
    `IQIYI_DRAMA_CLAIMED_TASK_INVALID: ${result.error.issues
      .map((issue) => `${issue.path.join(".") || "task"}: ${issue.message}`)
      .join("; ")}`,
  );
}

async function report(options: TaskApiOptions & {
  taskId: number;
  success: boolean;
  failStage?: IqiyiDramaTaskFailStage;
  errorMessage?: string;
  resultJson?: Record<string, unknown>;
}) {
  const payload = reportSchema.parse(await client(options).post(
    resolvedEndpoints(options).reportTask,
    {
      taskId: options.taskId,
      success: options.success,
      failStage: options.failStage,
      errorMessage: options.errorMessage,
      resultJson: options.resultJson,
    },
  ));
  assertSuccess(payload, "IQIYI_DRAMA_ACCOUNT_TASK_REPORT_FAILED");
  if (payload.data === false) throw new Error("IQIYI_DRAMA_ACCOUNT_TASK_REPORT_FAILED: data=false");
}

async function claim(
  options: ClaimNextIqiyiDramaTaskOptions,
  taskId: number,
  listed?: ReadyTask,
) {
  const payload = claimSchema.parse(await client(options).post(
    resolvedEndpoints(options).claimTask,
    { accountTaskId: taskId },
  ));
  assertSuccess(payload, "IQIYI_DRAMA_ACCOUNT_TASK_CLAIM_FAILED");
  if (!payload.data) return null;
  if (payload.data.accountTaskId !== taskId) {
    throw new Error(
      `IQIYI_DRAMA_CLAIMED_TASK_ID_MISMATCH: expected=${taskId} actual=${payload.data.accountTaskId}`,
    );
  }
  try {
    return normalizeClaimedTask(payload.data, listed, options.runtimeOptions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await report({
      ...options,
      taskId,
      success: false,
      failStage: /cover|poster|ownership|copyright|封面|海报|权属|文件/i.test(message)
        ? "UPLOAD_FILE"
        : "OTHER",
      errorMessage: message,
    }).catch(() => undefined);
    throw error;
  }
}

export async function claimNextIqiyiDramaTaskApi(
  options: ClaimNextIqiyiDramaTaskOptions,
): Promise<ClaimedIqiyiDramaTask | null> {
  const accountId = options.runtimeOptions?.iqiyiAccountId?.trim();
  if (!accountId) throw new Error("IQIYI_DRAMA_ACCOUNT_ID_REQUIRED");
  const payload = readyPageSchema.parse(await client(options).post(
    resolvedEndpoints(options).accountTaskPage,
    {
      page: 1,
      pageSize: 100,
      dramaId: null,
      originalTitle: null,
      accountId,
      accountName: null,
      status: "READY",
      auditStatus: null,
    },
  ));
  assertSuccess(payload, "IQIYI_DRAMA_ACCOUNT_TASK_PAGE_FAILED");
  const ready = (payload.data?.data ?? []).filter(
    (task) => task.accountId === accountId && task.status === "READY",
  );
  if (ready.length === 0) return null;
  log(options.runtimeOptions ?? {}, `[iqiyi-drama] fetched ${ready.length} READY task(s)`);
  for (const task of ready) {
    try {
      const claimed = await claim(options, task.id, task);
      if (claimed) return claimed;
    } catch (error) {
      log(
        options.runtimeOptions ?? {},
        `[iqiyi-drama] task claim failed: accountTaskId=${task.id} `
          + `error=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return null;
}

export async function reportIqiyiDramaTaskSuccessApi(
  options: IqiyiDramaTaskSuccessReport,
) {
  await report({ ...options, taskId: options.accountTaskId, success: true });
}

export async function reportIqiyiDramaTaskErrorApi(options: IqiyiDramaTaskErrorReport) {
  await report({
    ...options,
    taskId: options.accountTaskId,
    success: false,
    failStage: options.failStage,
    errorMessage: options.errorMessage,
  });
}
