import { z } from "zod";

export const douyinDramaUpdateStatusValues = ["已完结", "连载中"] as const;
export const douyinDramaAudienceValues = ["男频", "女频", "通用"] as const;
export const douyinDramaProductionCostRangeValues = [
  "30万以下",
  "30万（含）- 80万",
  "80万及以上",
] as const;
export const douyinDramaPublishModeValues = ["自主发布", "平台发布"] as const;

export type DouyinDramaLoginState = "login-required" | "logged-in" | "unknown";
export type DouyinDramaTaskFailStage =
  | "LOGIN"
  | "DOWNLOAD"
  | "FILL_FORM"
  | "UPLOAD_FILE"
  | "SUBMIT"
  | "OTHER";

const requiredText = z.string().trim().min(1);
const optionalText = z.string().trim().optional();
const fileReference = requiredText.describe("本地文件路径、剧目目录相对路径或 HTTP(S) 下载地址");

export const douyinDramaRoleSchema = z.object({
  name: requiredText.max(30),
  actorName: optionalText,
});

export const douyinDramaTaskPayloadSchema = z
  .object({
    title: requiredText.max(20),
    summary: requiredText.max(200),
    outsideSaleAlias: optionalText,
    outsideFreeAlias: optionalText,
    episodeCount: z.coerce.number().int().min(1).max(300),
    baiduPanResourceLink: optionalText,
    updateStatus: z.enum(douyinDramaUpdateStatusValues),
    isAi: z.boolean().default(true),
    aigcTools: z.array(requiredText).default(["红果漫剧创作Agent"]),
    categories: z.array(requiredText).min(1),
    audience: z.enum(douyinDramaAudienceValues),
    isSeries: z.boolean().default(false),
    isCopyrightIpAdaptation: z.boolean().default(false),
    copyrightIpName: optionalText,
    productionOrganization: requiredText.max(50),
    producers: z.array(requiredText).min(1),
    directors: z.array(requiredText).min(1),
    screenwriters: z.array(requiredText).min(1),
    roles: z.array(douyinDramaRoleSchema).min(2).max(10),
    productionCostRange: z.enum(douyinDramaProductionCostRangeValues),
    productionCostWan: z.coerce.number().int().positive(),
    contractName: optionalText,
    useFirstAvailableContract: z.boolean().default(false),
    brandAccountName: optionalText,
    publishMode: z.enum(douyinDramaPublishModeValues).default("平台发布"),
    scheduledPublishAt: optionalText,
    localHongguoCoverFile: fileReference.optional(),
    localDouyinCoverFile: fileReference.optional(),
    costConfigurationFiles: z.array(fileReference).default([]),
    payCommitmentFiles: z.array(fileReference).default([]),
    ownershipProofFiles: z.array(fileReference).default([]),
    nonInfringementCommitmentFiles: z.array(fileReference).default([]),
    projectScreenshotFiles: z.array(fileReference).max(5).default([]),
    submit: z.boolean().default(false),
  })
  .superRefine((value, context) => {
    if (value.isCopyrightIpAdaptation && !value.copyrightIpName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["copyrightIpName"],
        message: "版权专区 IP 改编作品必须提供已审核通过的 IP 名称",
      });
    }
    if (value.isAi && value.aigcTools.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["aigcTools"],
        message: "AI 作品必须至少关联一个 AIGC 工具",
      });
    }
    if (value.productionCostRange === "30万以下" && value.productionCostWan > 29) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["productionCostWan"],
        message: "制作金额为 30 万以下时，剧目制作成本必须为 1-29 的整数",
      });
    }
  });

export const claimedDouyinDramaTaskSchema = z.object({
  accountTaskId: z.coerce.number().int().positive(),
  dramaId: z.coerce.number().int().positive().optional(),
  originalTitle: requiredText,
  douyinAccountId: optionalText,
  douyinAccountName: optionalText,
  playlet: douyinDramaTaskPayloadSchema,
});

export type DouyinDramaRole = z.infer<typeof douyinDramaRoleSchema>;
export type DouyinDramaTaskPayload = z.infer<typeof douyinDramaTaskPayloadSchema>;
export type ClaimedDouyinDramaTask = z.infer<typeof claimedDouyinDramaTaskSchema>;

export type DouyinDramaRuntimeStatus = {
  platform: "douyin-drama";
  running: boolean;
  loginState: DouyinDramaLoginState;
  activeUrl?: string;
  createUrl: string;
  loginUrl: string;
  userDataDir: string;
  lastTask?: {
    accountTaskId: number;
    originalTitle: string;
    status: "running" | "succeeded" | "failed";
    errorMessage?: string;
    updatedAt: string;
  };
};

export type DouyinDramaRuntimeOptions = {
  accountProfileName?: string;
  apiBaseUrl?: string;
  mockTaskEnabled?: boolean;
  userDataDir?: string;
  credentialStatePath?: string;
  assetDownloadDir?: string;
  logFilePath?: string;
  logRetentionDays?: number;
  localEpisodeVideoRoot?: string;
  baiduNetdiskDownloadRetryAttempts?: number;
  episodeUploadWaitTimeoutMinutes?: number;
  taskPollIntervalMs?: number;
  config?: { browser?: { headless?: boolean; slowMo?: number } };
  onLog?: (message: string) => void;
  ensureBaiduNetdiskResource?: (request: {
    shareText: string;
    resourceName: string;
    localEpisodeVideoRoot: string;
    episodeCount: number;
    requiredOwnership?: { minimumImages?: number };
    requiredPosterImages?: number;
    requiredAiProductionProofFiles?: number;
    mergeOwnershipMaterials?: boolean;
  }) => Promise<unknown>;
};

export type DouyinDramaRuntime = {
  getStatus: () => DouyinDramaRuntimeStatus;
  stop: () => Promise<void>;
};
