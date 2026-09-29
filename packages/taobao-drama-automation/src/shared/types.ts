import { z } from "zod";
import type { DramaAiClient } from "@drama/ai";
import { TAOBAO_DRAMA_MAX_EPISODES_PER_TASK } from "./constants.js";

const requiredText = z.string().trim().min(1);

export const taobaoBatchUploadTaskSchema = z.object({
  id: requiredText,
  originalTitle: requiredText,
  baiduPanResourceLink: requiredText,
  episodeCount: z.coerce.number().int().min(1).max(TAOBAO_DRAMA_MAX_EPISODES_PER_TASK),
  sourceFileName: requiredText.optional(),
  sourceSheet: requiredText.optional(),
  sourceRow: z.number().int().positive().optional(),
  dramaTag: requiredText.optional(),
  episodeSummaries: z.array(requiredText).optional(),
  synopsisText: requiredText.optional(),
  synopsisSource: requiredText.optional(),
  metadataGeneratedAt: requiredText.optional(),
});

export const taobaoDramaTaskFailStageValues = [
  "LOGIN",
  "DOWNLOAD",
  "UPLOAD_FILE",
  "SUBMIT",
  "RECOGNIZE_RESULT",
  "OTHER",
] as const;

export type TaobaoBatchUploadTask = z.infer<typeof taobaoBatchUploadTaskSchema>;
export type TaobaoDramaTaskFailStage = (typeof taobaoDramaTaskFailStageValues)[number];
export type TaobaoDramaLoginState = "login-required" | "verification-required" | "logged-in" | "unknown";
export type TaobaoBatchUploadTaskProgress = "downloading" | "uploading";

export type TaobaoDramaRuntimeOptions = {
  accountProfileName?: string;
  accountDir?: string;
  userDataDir?: string;
  credentialStatePath?: string;
  assetDownloadDir?: string;
  logFilePath?: string;
  logRetentionDays?: number;
  localMaterialRoot?: string;
  baiduNetdiskDownloadRetryAttempts?: number;
  episodeUploadWaitTimeoutMinutes?: number;
  taskPollIntervalMs?: number;
  closeFailedTaskPages?: boolean;
  config?: { browser?: { headless?: boolean; slowMo?: number } };
  onLog?: (message: string) => void;
  onHumanVerificationRequired?: (details: { pages: string[] }) => Promise<void> | void;
  claimNextTask?: () => Promise<TaobaoBatchUploadTask | null>;
  updateTaskProgress?: (
    taskId: string,
    progress: TaobaoBatchUploadTaskProgress,
  ) => Promise<void> | void;
  aiClientFactory?: () => DramaAiClient;
  saveGeneratedMetadata?: (taskId: string, metadata: {
    dramaTag: string;
    episodeSummaries: string[];
    synopsisText?: string;
    synopsisSource?: string;
  }) => Promise<void> | void;
  completeTask?: (request: {
    taskId: string;
    success: boolean;
    errorMessage?: string;
  }) => Promise<void> | void;
  ensureBaiduNetdiskResource?: (request: {
    shareText: string;
    resourceName: string;
    localEpisodeVideoRoot: string;
    episodeCount: number;
    requiredPosterImages?: number;
    downloadAssetMaterials?: boolean;
    forceAssetDownload?: boolean;
    requireAllDiscoveredAssets?: boolean;
    requiredMetadataTextFiles?: number;
    posterFallback?: { title?: string; summary: string };
  }) => Promise<unknown>;
};

export type TaobaoDramaRuntimeStatus = {
  platform: "taobao-drama";
  running: boolean;
  loginState: TaobaoDramaLoginState;
  activeUrl?: string;
  batchPublishUrl: string;
  loginUrl: string;
  userDataDir: string;
  accountProfileName?: string;
  lastTask?: {
    taskId: string;
    originalTitle?: string;
    status: "running" | "succeeded" | "failed";
    errorMessage?: string;
    updatedAt: string;
  };
};

export type TaobaoDramaRuntime = {
  getStatus: () => TaobaoDramaRuntimeStatus;
  stop: () => Promise<void>;
};
