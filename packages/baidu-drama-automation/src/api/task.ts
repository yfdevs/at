import { z } from "zod";
import {
  claimedBaiduDramaTaskSchema,
  type BaiduDramaRuntimeOptions,
  type BaiduDramaTaskFailStage,
  type ClaimedBaiduDramaTask,
} from "../shared/types.js";

const apiResponseBaseSchema = z.object({
  code: z.number(),
  msg: z.string().nullish(),
});

const baiduDramaClaimDataSchema = z.object({
  accountTaskId: z.coerce.number().int().positive(),
  originalTitle: z.string().trim().min(1),
  accountId: z.string().trim().nullish(),
  accountName: z.string().trim().nullish(),
  payloadJson: z.unknown(),
});

export const baiduDramaClaimResponseSchema = apiResponseBaseSchema.extend({
  data: baiduDramaClaimDataSchema.nullish(),
});

export const baiduDramaReportResponseSchema = apiResponseBaseSchema.extend({
  data: z.boolean().nullish(),
});

export type BaiduDramaTaskApiOptions = { runtimeOptions?: BaiduDramaRuntimeOptions };
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

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

export function normalizeClaimedBaiduDramaTask(
  input: z.input<typeof baiduDramaClaimDataSchema>,
): ClaimedBaiduDramaTask {
  const claimed = baiduDramaClaimDataSchema.parse(input);
  const payload = parsePayloadJson(claimed.payloadJson);
  const platformPayload = recordValue(payload.baiduPlaylet);
  const baiduPlaylet = Object.keys(platformPayload).length > 0 ? platformPayload : payload;

  return claimedBaiduDramaTaskSchema.parse({
    accountTaskId: claimed.accountTaskId,
    originalTitle: claimed.originalTitle,
    baiduAccountId: claimed.accountId,
    baiduAccountName: claimed.accountName,
    playlet: {
      ...baiduPlaylet,
      title: stringValue(baiduPlaylet.title) ?? stringValue(payload.name),
      summary: stringValue(baiduPlaylet.summary) ?? stringValue(payload.summary),
      episodeCount: numberValue(baiduPlaylet.episodeCount) ?? numberValue(payload.episodeCount),
      baiduPanResourceLink:
        stringValue(baiduPlaylet.baiduPanResourceLink) ?? stringValue(payload.baiduPanResourceLink),
      productionOrganization:
        stringValue(baiduPlaylet.productionOrganization) ?? stringValue(payload.producerName),
      copyright: recordValue(payload.copyright),
      qualification: recordValue(payload.qualification),
      productionCost: recordValue(payload.productionCost),
      submit: booleanValue(baiduPlaylet.submit) ?? booleanValue(payload.submit) ?? true,
    },
  });
}

export function createMockBaiduDramaTask(): ClaimedBaiduDramaTask {
  return normalizeClaimedBaiduDramaTask({
    accountTaskId: 1,
    originalTitle: "赶海救下美人鱼，她让整片大海来报恩",
    accountId: "baidu-drama-test-account",
    accountName: "百度短剧测试账号",
    payloadJson: {
      name: "赶海救下美人鱼，她让整片大海来报恩",
      summary:
        "小伙林海被亲叔谋害踹入大海，危难之际被鲛人少女宁汐救下。宁汐调动海中生灵报恩，助林海满载珍贵海货死里逃生。他手握鲛鳞，赢回父亲遗留渔船，却意外撞破瀚洋集团的海底秘密。一边是凶险海上博弈，一边是鲛人少女的相助，林海步步追查，誓要揭开父亲失踪的真相。",
      episodeCount: 10,
      baiduPanResourceLink:
        "通过网盘分享的文件：赶海救下美人鱼，她让整片大海来报恩\n" +
        "链接: https://pan.baidu.com/s/1DqxBmsaWkLKKol5uHKxDNQ?pwd=hm6f 提取码: hm6f\n" +
        "小桃漫画新剧@柒",
      producerName: "明星说（北京）科技有限公司",
      copyright: {
        productionProofFiles: [
          "https://bj.bcebos.com/baidu-rmb-video-cover-1/195322e5336f31d7832ed44681f758cb.docx",
        ],
        licenseProofFiles: [
          "https://pic.rmb.bdstatic.com/3d65a5ef802677c1269fe74cc55805b4.png?mock=license",
        ],
      },
      qualification: {
        type: "其他微短剧",
        proofFiles: [
          "https://pic.rmb.bdstatic.com/3d65a5ef802677c1269fe74cc55805b4.png?mock=qualification",
        ],
      },
      productionCost: {
        amountWan: 1,
        proofFiles: ["https://pic.rmb.bdstatic.com/3d65a5ef802677c1269fe74cc55805b4.png?mock=cost"],
      },
      baiduPlaylet: {
        title: "赶海救下美人鱼，她让整片大海来报恩",
        audienceType: "男频",
        secondaryCategory: "奇幻",
        updateStatus: "已完结",
        topic: "赶海",
        isMatched: false,
        director: { name: "米苏", gender: "男" },
        producers: ["米苏"],
        screenwriters: ["米苏"],
        actors: [
          { name: "林海", roleName: "林海" },
          { name: "宁汐", roleName: "宁汐" },
        ],
        submit: true,
      },
    },
  });
}

// 后端接口地址尚未提供。接口就绪后只替换此函数内部即可。
export async function claimNextBaiduDramaTaskApi(
  options: BaiduDramaTaskApiOptions,
): Promise<ClaimedBaiduDramaTask | null> {
  void options;
  if (mockTaskClaimed) return null;
  mockTaskClaimed = true;
  return createMockBaiduDramaTask();
}

export async function reportBaiduDramaTaskSuccessApi(
  options: BaiduDramaTaskApiOptions & {
    accountTaskId: number;
  },
): Promise<void> {
  void options;
}

export async function reportBaiduDramaTaskErrorApi(
  options: BaiduDramaTaskApiOptions & {
    accountTaskId: number;
    failStage: BaiduDramaTaskFailStage;
    errorMessage: string;
  },
): Promise<void> {
  void options;
}
