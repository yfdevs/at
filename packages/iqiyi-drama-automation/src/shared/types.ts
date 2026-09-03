import type { DramaAiClient } from "@drama/ai";
import { z } from "zod";

export type IqiyiDramaLoginState = "login-required" | "logged-in" | "unknown";
export type IqiyiDramaTaskStatus = "READY" | "RUNNING" | "SUCCESS" | "FAILED";
export type IqiyiDramaTaskFailStage =
  | "LOGIN"
  | "FILL_FORM"
  | "UPLOAD_FILE"
  | "SUBMIT"
  | "RECOGNIZE_RESULT"
  | "OTHER";

const requiredText = z.string().trim().min(1);
const optionalText = z.string().trim().optional();
const fileReference = requiredText.describe("本地文件路径或 HTTP(S) 下载地址。");
const iqiyiCopyrightSchema = z.object({
  productionProofFiles: z.array(fileReference).max(20),
  licenseProofFiles: z.array(fileReference).max(20),
}).strict();

export const iqiyiDramaTypeValues = ["short-drama", "comic-drama"] as const;
export const iqiyiContentSourceValues = [
  "小说改编",
  "漫画改编",
  "游戏改编",
  "影视改编",
  "原创",
] as const;
export const iqiyiVisualTypeValues = [
  "AI剧",
  "AI 2D",
  "AI 3D",
  "动态漫",
  "沙雕漫",
  "其他",
] as const;
export const iqiyiAudienceTypeValues = ["男频", "女频", "平衡"] as const;

export const iqiyiDramaTaskPayloadSchema = z.object({
  dramaType: z.enum(iqiyiDramaTypeValues),
  title: requiredText.max(30),
  summary: requiredText.min(100).max(300),
  episodeCount: z.coerce.number().int().min(1).max(2000),
  baiduPanResourceLink: optionalText,
  verticalCoverFile: fileReference.optional(),
  horizontalCoverFile: fileReference.optional(),
  copyright: iqiyiCopyrightSchema,
  audienceType: z.enum(iqiyiAudienceTypeValues),
  visualType: z.enum(iqiyiVisualTypeValues),
  primaryCategory: optionalText,
  secondaryCategories: z.array(requiredText),
  productionOrganization: requiredText,
  productionCostYuan: z.coerce.number().finite().nonnegative().max(999_999_999),
  contentSource: z.enum(iqiyiContentSourceValues),
}).strict();

export const claimedIqiyiDramaTaskSchema = z.object({
  accountTaskId: z.coerce.number().int().positive(),
  dramaId: z.coerce.number().int().positive().optional(),
  originalTitle: requiredText,
  iqiyiAccountId: optionalText,
  iqiyiAccountName: optionalText,
  playlet: iqiyiDramaTaskPayloadSchema,
});

export type IqiyiDramaType = z.infer<typeof iqiyiDramaTaskPayloadSchema>["dramaType"];
export type IqiyiDramaTaskPayload = z.infer<typeof iqiyiDramaTaskPayloadSchema>;
export type ClaimedIqiyiDramaTask = z.infer<typeof claimedIqiyiDramaTaskSchema>;

export type IqiyiDramaApiConfig = {
  baseUrl: string;
  timeoutMs?: number;
};

export type IqiyiDramaRuntimeStatus = {
  platform: "iqiyi-drama";
  running: boolean;
  loginState: IqiyiDramaLoginState;
  activeUrl?: string;
  shortDramaCreateUrl: string;
  comicDramaCreateUrl: string;
  loginUrl: string;
  userDataDir: string;
  accountProfileName?: string;
  accountDir?: string;
  credentialStatePath?: string;
  assetDownloadDir?: string;
  logFilePath?: string;
  lastTask?: {
    accountTaskId: number;
    originalTitle?: string;
    dramaType?: IqiyiDramaType;
    status: "running" | "succeeded" | "failed";
    errorMessage?: string;
    updatedAt: string;
  };
};

export type IqiyiDramaRuntimeOptions = {
  accountProfileName?: string;
  accountDir?: string;
  userDataDir?: string;
  credentialStatePath?: string;
  assetDownloadDir?: string;
  logFilePath?: string;
  logRetentionDays?: number;
  iqiyiAccountId?: string;
  iqiyiAccountName?: string;
  apiConfig?: IqiyiDramaApiConfig;
  localMaterialRoot?: string;
  baiduNetdiskDownloadRetryAttempts?: number;
  videoUploadTimeoutMinutes?: number;
  taskPollIntervalMs?: number;
  closeFailedTaskPages?: boolean;
  aiClient?: DramaAiClient;
  aiImageModel?: string;
  config?: {
    browser?: {
      headless?: boolean;
      slowMo?: number;
    };
  };
  onLog?: (message: string) => void;
  ensureBaiduNetdiskResource?: (request: {
    shareText: string;
    resourceName: string;
    localEpisodeVideoRoot: string;
    episodeCount: number;
    downloadEpisodeVideos?: boolean;
    forceAssetDownload?: boolean;
    requiredOwnership?: { minimumImages?: number };
    requiredOwnershipFiles?: number;
    requiredPosterImages?: number;
    posterFallback?: { title?: string; summary: string };
  }) => Promise<unknown>;
};

export type IqiyiDramaRuntime = {
  getStatus: () => IqiyiDramaRuntimeStatus;
  stop: () => Promise<void>;
};
