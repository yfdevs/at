import { z } from "zod";

import {
  claimedIqiyiDramaTaskSchema,
  type ClaimedIqiyiDramaTask,
  type IqiyiDramaApiConfig,
  type IqiyiDramaRuntimeOptions,
  type IqiyiDramaTaskFailStage,
  type IqiyiDramaTaskStatus,
  type IqiyiDramaType,
  iqiyiContentSourceValues,
} from "../shared/types.js";
import { ensureIqiyiMockAssets, iqiyiMockAssetPaths } from "../shared/mock-assets.js";

export type IqiyiDramaTaskApiEndpoints = {
  accountTaskPage: string;
  claimTask: string;
  reportTask: string;
};

type TaskApiOptions = {
  apiConfig?: IqiyiDramaApiConfig;
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

const readyTaskSchema = z.object({
  id: z.coerce.number().int().positive(),
  dramaId: z.coerce.number().int().positive().optional(),
  accountId: z.string().trim().min(1),
  accountName: z.string().nullish(),
  status: z.string().nullish(),
  originalTitle: z.string().nullish(),
}).passthrough();
const claimDataSchema = z.object({
  accountTaskId: z.coerce.number().int().positive(),
  originalTitle: z.string().nullish(),
  accountId: z.string().nullish(),
  payloadJson: z.unknown(),
});

type ReadyTask = z.infer<typeof readyTaskSchema>;
type ClaimData = z.infer<typeof claimDataSchema>;
let mockTaskClaimed = false;

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

function contentSource(value: unknown) {
  const normalized = text(value)?.toLowerCase().replace(/[\s_-]/g, "");
  if (!normalized) return "原创" as const;
  const exactValue = iqiyiContentSourceValues.find(
    (item) => item.toLowerCase().replace(/[\s_-]/g, "") === normalized,
  );
  if (exactValue) return exactValue;
  if (normalized.includes("小说") || normalized === "novel") return "小说改编" as const;
  if (normalized.includes("漫画") || normalized === "comic" || normalized === "manga") {
    return "漫画改编" as const;
  }
  if (normalized.includes("游戏") || normalized === "game") return "游戏改编" as const;
  if (
    normalized.includes("影视")
    || normalized.includes("电影")
    || normalized.includes("电视剧")
    || normalized === "film"
    || normalized === "tv"
  ) return "影视改编" as const;
  if (normalized.includes("原创") || normalized === "original") return "原创" as const;
  throw new Error(`IQIYI_DRAMA_CONTENT_SOURCE_INVALID: ${text(value) ?? String(value)}`);
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
  const copyright = record(playlet.copyright ?? payload.copyright);
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
      copyright: {
        productionProofFiles: unique(texts(copyright.productionProofFiles)),
        licenseProofFiles: unique(texts(copyright.licenseProofFiles)),
      },
      secondaryCategories: texts(
        playlet.secondaryCategories ?? playlet.tags ?? playlet.categoryTags,
      ),
      visualType: text(playlet.visualType)
        ?? text(playlet.pictureType)
        ?? text(playlet.renderType),
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
      productionYear: numberValue(playlet.productionYear ?? playlet.year),
      contentSource: contentSource(
        playlet.contentSource
          ?? playlet.adaptationType
          ?? playlet.sourceType
          ?? payload.contentSource,
      ),
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

export function createMockIqiyiDramaTask(
  runtimeOptions: IqiyiDramaRuntimeOptions = {},
): ClaimedIqiyiDramaTask {
  const accountId = runtimeOptions.iqiyiAccountId?.trim() || "iqiyi-drama-test-account";
  const accountName = runtimeOptions.iqiyiAccountName?.trim() || "爱奇艺漫剧测试账号";
  const originalTitle = "赶海救下美人鱼，她让整片大海来报恩";
  const mockAssets = iqiyiMockAssetPaths(runtimeOptions);

  return normalizeClaimedTask(
    {
      accountTaskId: 1,
      originalTitle,
      accountId,
      payloadJson: {
        name: originalTitle,
        summary:
          "小伙林海被亲叔谋害后跌入大海，危难之际被鲛人少女宁汐救下。宁汐为了报答林海曾经的善意，召集海中生灵帮助他寻找珍贵海货，也让他重新夺回父亲留下的渔船。随着两人继续追查往事，他们意外发现瀚洋集团隐藏多年的海底秘密，并在亲情、利益与守护海洋之间作出最终选择。",
        episodeCount: 10,
        baiduPanResourceLink:
          "通过网盘分享的文件：赶海救下美人鱼，她让整片大海来报恩\n"
          + "链接: https://pan.baidu.com/s/1DqxBmsaWkLKKol5uHKxDNQ?pwd=hm6f 提取码: hm6f",
        producerName: "明星说（北京）科技有限公司",
        copyright: {
          productionProofFiles: [mockAssets.productionContract],
          licenseProofFiles: [mockAssets.copyrightProof],
        },
        iqiyiPlaylet: {
          dramaType: "comic-drama",
          title: originalTitle,
          audienceType: "男频",
          visualType: "AI剧",
          contentSource: "小说改编",
          adaptationSource: originalTitle,
          primaryCategory: "奇幻",
          secondaryCategories: ["大女主", "搞笑"],
          productionOrganization: "明星说（北京）科技有限公司",
          productionCostYuan: 10_000,
          actors: [],
          isAiGenerated: "是",
          submit: false,
        },
      },
    },
    {
      id: 1,
      dramaId: 1,
      accountId,
      accountName,
      status: "READY",
      originalTitle,
    },
    runtimeOptions,
  );
}

export function resetMockIqiyiDramaTaskApiForTesting() {
  mockTaskClaimed = false;
}

// 后端接口尚未提供。正式领取接口接入后，只替换此方法内部。
export async function claimNextIqiyiDramaTaskApi(
  options: ClaimNextIqiyiDramaTaskOptions,
): Promise<ClaimedIqiyiDramaTask | null> {
  if (mockTaskClaimed) return null;
  ensureIqiyiMockAssets(options.runtimeOptions);
  mockTaskClaimed = true;
  return createMockIqiyiDramaTask(options.runtimeOptions);
}

// 后端接口尚未提供。正式成功上报接口接入后，只替换此方法内部。
export async function reportIqiyiDramaTaskSuccessApi(
  options: IqiyiDramaTaskSuccessReport,
): Promise<void> {
  void options;
}

// 后端接口尚未提供。正式失败上报接口接入后，只替换此方法内部。
export async function reportIqiyiDramaTaskErrorApi(
  options: IqiyiDramaTaskErrorReport,
): Promise<void> {
  void options;
}
