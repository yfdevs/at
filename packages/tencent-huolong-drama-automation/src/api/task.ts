import { z } from "zod";
import { isBrowserClosedError } from "@drama/automation-logging";
import {
  claimedTencentHuolongDramaTaskSchema,
  type ClaimedTencentHuolongDramaTask,
  type TencentHuolongRuntimeOptions,
  type TencentHuolongTaskFailStage,
} from "../shared/types.js";
import { createTencentHuolongHttpClient } from "./http-client.js";
import { ensureLocalTencentHuolongMockFiles } from "./local-mock-files.js";

const useLocalMockTaskSource = true;

// A structural placeholder keeps the synchronous mock-task factory useful in
// validation tests. claimNextTencentHuolongDramaTask replaces it with a locally
// generated, valid test PDF before the task enters the automation runtime.
const localMockCostAnalysisFile =
  "https://example.invalid/tencent-huolong/replace-with-cost-analysis-commitment.pdf";

const localMockTask = claimedTencentHuolongDramaTaskSchema.parse({
  accountTaskId: 900001,
  dramaId: 900001,
  originalTitle: "车位风波",
  accountId: "default",
  accountName: "腾讯火龙漫剧本地账号",
  playlet: {
    title: "车位风波",
    summary:
      "沈悦因车位被占和婆家起冲突，公公许广田为顾权威收回车位卡，购置新车位接济亲戚。不料蹭停剐蹭频发，他雨夜帮人占位摔伤，面对赔偿终于醒悟，懂得依靠规则维护权益，理解了儿媳的委屈。",
    episodeCount: 40,
    baiduPanResourceLink:
      "链接: https://pan.baidu.com/s/15hOcSd7evsFenNN3Smtr7w?pwd=drb3 提取码: drb3",
    protagonistName: "沈悦",
    isAiRealPersonShortDrama: "否",
    themeType: "都市",
    costAnalysisFiles: [localMockCostAnalysisFile],
    copyrightProofFiles: [],
    productionProcessFiles: [],
  },
});

let localMockTaskClaimed = false;

export function getLocalTencentHuolongDramaTask(): ClaimedTencentHuolongDramaTask {
  return {
    ...localMockTask,
    playlet: {
      ...localMockTask.playlet,
      costAnalysisFiles: [...localMockTask.playlet.costAnalysisFiles],
      copyrightProofFiles: [...localMockTask.playlet.copyrightProofFiles],
      productionProcessFiles: [...localMockTask.playlet.productionProcessFiles],
    },
  };
}

const responseBaseSchema = z.object({ code: z.number(), msg: z.string().nullish() });
const listItemSchema = z
  .object({
    id: z.coerce.number().int().positive(),
    dramaId: z.coerce.number().int().positive().optional(),
    accountId: z.string().trim(),
    accountName: z.string().nullish(),
    originalTitle: z.string().nullish(),
  })
  .passthrough();
const pageSchema = responseBaseSchema.extend({
  data: z.object({ data: z.array(listItemSchema) }).nullish(),
});
const claimSchema = responseBaseSchema.extend({
  data: z
    .object({
      accountTaskId: z.coerce.number().int().positive(),
      originalTitle: z.string().nullish(),
      accountId: z.string().nullish(),
      payloadJson: z.unknown(),
    })
    .nullish(),
});

function client(options: TencentHuolongRuntimeOptions) {
  if (!options.apiConfig) throw new Error("TENCENT_HUOLONG_DRAMA_API_BASE_URL_REQUIRED");
  return createTencentHuolongHttpClient(options.apiConfig);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value === "string") return record(JSON.parse(value));
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function files(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (text(item) ? [text(item)!] : []));
}

function yesNo(value: unknown) {
  if (value === true || value === 1 || value === "1" || value === "是") return "是";
  if (value === false || value === 0 || value === "0" || value === "否") return "否";
  return undefined;
}

function normalizeTask(
  claimed: z.infer<typeof claimSchema>["data"],
  listed: z.infer<typeof listItemSchema>,
) {
  if (!claimed) return null;
  const payload = record(claimed.payloadJson);
  const playlet = record(
    payload.tencentHuolongPlaylet ?? payload.huolongPlaylet ?? payload.playlet,
  );
  const copyright = record(payload.copyright);
  const production = record(payload.production);
  const productionCost = record(payload.productionCost);
  return claimedTencentHuolongDramaTaskSchema.parse({
    accountTaskId: claimed.accountTaskId,
    dramaId: listed.dramaId,
    originalTitle: claimed.originalTitle ?? listed.originalTitle,
    accountId: claimed.accountId ?? listed.accountId,
    accountName: listed.accountName,
    playlet: {
      ...playlet,
      title: text(playlet.title) ?? text(payload.name),
      summary: text(playlet.summary) ?? text(payload.summary),
      episodeCount: playlet.episodeCount ?? payload.episodeCount,
      baiduPanResourceLink:
        text(playlet.baiduPanResourceLink) ?? text(payload.baiduPanResourceLink),
      protagonistName: text(playlet.protagonistName),
      isAiRealPersonShortDrama:
        yesNo(playlet.isAiRealPersonShortDrama ?? payload.isAiRealPersonShortDrama) ?? "否",
      themeType:
        text(playlet.themeType) ??
        text(playlet.theme) ??
        text(payload.themeType) ??
        text(payload.theme),
      costAnalysisFiles: files(
        playlet.costAnalysisFiles ?? productionCost.proofFiles ?? production.costAnalysisFiles,
      ),
      copyrightProofFiles: [
        ...files(
          playlet.copyrightProofFiles ?? copyright.productionProofFiles ?? copyright.proofFiles,
        ),
        ...files(copyright.licenseProofFiles),
      ],
      productionProcessFiles: files(playlet.productionProcessFiles ?? production.processFiles),
    },
  });
}

export async function claimNextTencentHuolongDramaTask(
  options: TencentHuolongRuntimeOptions,
): Promise<ClaimedTencentHuolongDramaTask | null> {
  if (useLocalMockTaskSource) {
    if (localMockTaskClaimed) return null;
    if (options.accountId && options.accountId !== localMockTask.accountId) return null;
    const task = getLocalTencentHuolongDramaTask();
    const mockFiles = await ensureLocalTencentHuolongMockFiles(options);
    task.playlet.costAnalysisFiles = [mockFiles.costAnalysisFile];
    localMockTaskClaimed = true;
    return task;
  }
  const api = client(options);
  const page = pageSchema.parse(
    await api.post("/dramaAiRpa/tencent/accountTask/page", {
      page: 1,
      pageSize: 100,
      accountId: options.accountId ?? null,
      status: "READY",
    }),
  );
  if (page.code !== 0)
    throw new Error(`TENCENT_HUOLONG_DRAMA_TASK_LIST_FAILED: ${page.msg || page.code}`);
  const listed = page.data?.data[0];
  if (!listed) return null;
  const claim = claimSchema.parse(
    await api.post("/dramaAiRpa/tencent/rpa/claim", {
      accountTaskId: listed.id,
      accountId: options.accountId ?? listed.accountId,
      rpaStatus: "RUNNING",
    }),
  );
  if (claim.code !== 0)
    throw new Error(`TENCENT_HUOLONG_DRAMA_TASK_CLAIM_FAILED: ${claim.msg || claim.code}`);
  return normalizeTask(claim.data, listed);
}

export async function reportTencentHuolongDramaTask(
  options: TencentHuolongRuntimeOptions & {
    accountTaskId: number;
    status: "SUCCESS" | "FAILED";
    failStage?: TencentHuolongTaskFailStage;
    errorMessage?: string;
    resultJson?: Record<string, unknown>;
  },
) {
  if (options.status === "FAILED" && isBrowserClosedError(options.errorMessage)) return;
  if (useLocalMockTaskSource) {
    // 本地模拟模式没有远端任务，因此不需要回写任务状态。
    return;
  }
  const result = responseBaseSchema.parse(
    await client(options).post("/dramaAiRpa/tencent/rpa/report", {
      accountTaskId: options.accountTaskId,
      rpaStatus: options.status,
      failStage: options.failStage,
      errorMessage: options.errorMessage,
      resultJson: options.resultJson ?? {},
    }),
  );
  if (result.code !== 0)
    throw new Error(`TENCENT_HUOLONG_DRAMA_TASK_REPORT_FAILED: ${result.msg || result.code}`);
}
