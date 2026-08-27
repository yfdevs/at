import { z } from "zod";
import {
  claimedDouyinDramaTaskSchema,
  type ClaimedDouyinDramaTask,
  type DouyinDramaRuntimeOptions,
  type DouyinDramaTaskFailStage,
} from "../shared/types.js";

const apiResponseBaseSchema = z.object({
  code: z.number(),
  msg: z.string().nullish(),
});

const douyinDramaClaimDataSchema = z.object({
  accountTaskId: z.coerce.number().int().positive(),
  originalTitle: z.string().trim().min(1),
  accountId: z.string().trim().nullish(),
  accountName: z.string().trim().nullish(),
  payloadJson: z.unknown(),
});

export const douyinDramaClaimResponseSchema = apiResponseBaseSchema.extend({
  data: douyinDramaClaimDataSchema.nullish(),
});

export const douyinDramaReportResponseSchema = apiResponseBaseSchema.extend({
  data: z.boolean().nullish(),
});

export type DouyinDramaTaskApiOptions = { runtimeOptions?: DouyinDramaRuntimeOptions };
let mockTaskClaimed = false;

const jsonRecordSchema = z.record(z.unknown());

function recordValue(value: unknown) {
  const result = jsonRecordSchema.safeParse(value);
  return result.success ? result.data : {};
}

function parsePayloadJson(value: unknown) {
  if (typeof value === "string") return jsonRecordSchema.parse(JSON.parse(value));
  return jsonRecordSchema.parse(value);
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

export function normalizeClaimedDouyinDramaTask(
  input: z.input<typeof douyinDramaClaimDataSchema>,
): ClaimedDouyinDramaTask {
  const claimed = douyinDramaClaimDataSchema.parse(input);
  const payload = parsePayloadJson(claimed.payloadJson);
  const platformPayload = recordValue(payload.douyinPlaylet);
  const playlet = Object.keys(platformPayload).length > 0 ? platformPayload : payload;

  return claimedDouyinDramaTaskSchema.parse({
    accountTaskId: claimed.accountTaskId,
    originalTitle: claimed.originalTitle,
    douyinAccountId: claimed.accountId,
    douyinAccountName: claimed.accountName,
    playlet: {
      ...playlet,
      title: stringValue(playlet.title) ?? stringValue(payload.name),
      summary: stringValue(playlet.summary) ?? stringValue(payload.summary),
      episodeCount: numberValue(playlet.episodeCount) ?? numberValue(payload.episodeCount),
      baiduPanResourceLink:
        stringValue(playlet.baiduPanResourceLink) ?? stringValue(payload.baiduPanResourceLink),
      productionOrganization:
        stringValue(playlet.productionOrganization) ?? stringValue(payload.producerName),
    },
  });
}

export function createMockDouyinDramaTask(): ClaimedDouyinDramaTask {
  return normalizeClaimedDouyinDramaTask({
    accountTaskId: 1,
    originalTitle: "赶海救下美人鱼，她让整片大海来报恩",
    accountId: "douyin-drama-test-account",
    accountName: "抖音短剧测试账号",
    payloadJson: {
      name: "赶海救下美人鱼，她让整片大海来报恩",
      summary:
        "小伙林海被亲叔谋害踹入大海，危难之际被鲛人少女宁汐救下。宁汐调动海中生灵报恩，助林海满载珍贵海货死里逃生。他手握鲛鳞，赢回父亲遗留渔船，却意外撞破瀚洋集团的海底秘密。",
      episodeCount: 10,
      baiduPanResourceLink:
        "通过网盘分享的文件：赶海救下美人鱼，她让整片大海来报恩\n" +
        "链接: https://pan.baidu.com/s/1DqxBmsaWkLKKol5uHKxDNQ?pwd=hm6f 提取码: hm6f",
      producerName: "明星说（北京）科技有限公司",
      douyinPlaylet: {
        title: "赶海救下美人鱼，她让整片大海来报恩",
        outsideSaleAlias: "赶海美人鱼",
        outsideFreeAlias: "沧海奇缘",
        updateStatus: "已完结",
        isAi: true,
        aigcTools: ["红果漫剧创作Agent"],
        categories: ["奇幻"],
        audience: "男频",
        isSeries: false,
        isCopyrightIpAdaptation: false,
        productionOrganization: "明星说（北京）科技有限公司",
        producers: ["米苏"],
        directors: ["米苏"],
        screenwriters: ["米苏"],
        roles: [
          { name: "林海", actorName: "林海" },
          { name: "宁汐", actorName: "宁汐" },
        ],
        productionCostRange: "30万以下",
        productionCostWan: 1,
        useFirstAvailableContract: true,
        publishMode: "平台发布",
        costConfigurationFiles: [],
        ownershipProofFiles: [],
        nonInfringementCommitmentFiles: [],
        projectScreenshotFiles: [],
        submit: false,
      },
    },
  });
}

export function resetMockDouyinDramaTaskApiForTesting() {
  mockTaskClaimed = false;
}

// 后端接口地址尚未确定。正式接口接入后只替换以下三个空 API 方法内部。
export async function claimNextDouyinDramaTaskApi(
  options: DouyinDramaTaskApiOptions,
): Promise<ClaimedDouyinDramaTask | null> {
  if (!options.runtimeOptions?.mockTaskEnabled) return null;
  if (mockTaskClaimed) return null;
  mockTaskClaimed = true;
  return createMockDouyinDramaTask();
}

export async function reportDouyinDramaTaskSuccessApi(
  options: DouyinDramaTaskApiOptions & { accountTaskId: number },
): Promise<void> {
  void options;
}

export async function reportDouyinDramaTaskErrorApi(
  options: DouyinDramaTaskApiOptions & {
    accountTaskId: number;
    failStage: DouyinDramaTaskFailStage;
    errorMessage: string;
  },
): Promise<void> {
  void options;
}
