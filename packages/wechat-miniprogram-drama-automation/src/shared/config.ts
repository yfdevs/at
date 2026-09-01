import path from "node:path";
import { getWechatMiniProgramRuntimeSettings } from "./runtime-settings.js";
import { numberSetting, secondsSettingToMs } from "./settings-value.js";
import type { ClaimedAccountTask, Config } from "./types.js";
import { fetchDramaAiRpaDetailApi } from "../api/drama-ai-rpa.js";
import {
  fetchWechatMiniProgramAccountsApi,
  type WechatMiniProgramAccount,
} from "../api/mini-program-accounts.js";
import { createLogger } from "./logger.js";

const configLogger = createLogger("config");

const serviceBrowserHeadless = false;
const serviceBrowserSlowMo = 20;
const emptyClaimDelaySeconds = 5;
const slowEmptyClaimThreshold = 10;
const slowEmptyClaimDelaySeconds = 30;
const videoAccountSyncIntervalSeconds = 60;
const idlePageRefreshIntervalSeconds = 1500;
const idlePageRefreshTimeoutSeconds = 60;
const idlePageRefreshJitterSeconds = 300;

const contractSubjectAliases: Record<string, string> = {
  "明星说": "MINGXINGSHUO",
  "米苏": "MISU",
  "微淘": "WEITAO",
  "幻走": "HUANZOU",
  "小石榴": "XIAOSHILIU",
  "有点牛": "YOUDIANNIU",
  "珍萃": "ZHENCUIYIHAO",
  "瑞小豆": "RUIXIAODOU",
};
export const mingxingshuoContractSubject = "MINGXINGSHUO";

export function normalizeContractSubject(value: string): string {
  const trimmedValue = value.trim();
  return contractSubjectAliases[trimmedValue] ?? trimmedValue.toUpperCase();
}

export function resolveFromRoot(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

export function resolveRunDataPath(...segments: string[]): string {
  const runDataDir = getWechatMiniProgramRuntimeSettings().runDataDir || ".drama-runs/wechat-miniprogram-drama";
  return path.join(resolveFromRoot(runDataDir), ...segments);
}

export interface ServiceConfig {
  videoAccounts: WechatMiniProgramAccount[];
  authRoot: string;
  browser: {
    headless: boolean;
    slowMo: number;
  };
  worker: {
    emptyClaimDelayMs: number;
    slowEmptyClaimThreshold: number;
    slowEmptyClaimDelayMs: number;
  };
  videoAccountSync: {
    intervalMs: number;
  };
  idlePageRefresh: {
    intervalMs: number;
    timeoutMs: number;
    jitterMs: number;
  };
}

export async function loadServiceConfig(): Promise<ServiceConfig> {
  const settings = getWechatMiniProgramRuntimeSettings();
  const videoAccounts = await fetchWechatMiniProgramAccountsApi();
  const accountIds = videoAccounts.map((account) => account.id);
  configLogger.info("账号列表已更新", {
    accountCount: videoAccounts.length,
    source: "wechat-mini-program-account-api",
  });

  if (videoAccounts.length === 0) {
    throw new Error("微信小程序账号接口至少需要返回一个启用账号");
  }
  if (new Set(accountIds).size !== accountIds.length) {
    throw new Error("Video account list must not contain duplicate account ids.");
  }
  if (videoAccounts.some((account) => !account.id || !account.name)) {
    throw new Error("Video account id and name are required.");
  }
  return {
    videoAccounts,
    authRoot: resolveRunDataPath("auth", "channels"),
    browser: {
      headless: serviceBrowserHeadless,
      slowMo: serviceBrowserSlowMo,
    },
    worker: {
      emptyClaimDelayMs: secondsSettingToMs(settings.workerEmptyClaimDelaySeconds, emptyClaimDelaySeconds),
      slowEmptyClaimThreshold: numberSetting(settings.workerSlowEmptyClaimThreshold, slowEmptyClaimThreshold),
      slowEmptyClaimDelayMs: secondsSettingToMs(settings.workerSlowEmptyClaimDelaySeconds, slowEmptyClaimDelaySeconds),
    },
    videoAccountSync: {
      intervalMs: secondsSettingToMs(settings.videoAccountSyncIntervalSeconds, videoAccountSyncIntervalSeconds),
    },
    idlePageRefresh: {
      intervalMs: secondsSettingToMs(settings.idlePageRefreshIntervalSeconds, idlePageRefreshIntervalSeconds),
      timeoutMs: secondsSettingToMs(settings.idlePageRefreshTimeoutSeconds, idlePageRefreshTimeoutSeconds),
      jitterMs: secondsSettingToMs(settings.idlePageRefreshJitterSeconds, idlePageRefreshJitterSeconds),
    },
  };
}

function normalizeWechatAiContent(playletConfig: Config): Config {
  const rawPlaylet = playletConfig.playlet as Config["playlet"] & {
    aiContent?: unknown;
    aiProductionProofFiles?: unknown;
  };
  const aiContent = typeof rawPlaylet.aiContent === "boolean" ? rawPlaylet.aiContent : true;
  const aiProductionProofFiles = aiContent && Array.isArray(rawPlaylet.aiProductionProofFiles)
    ? rawPlaylet.aiProductionProofFiles.filter(
      (value): value is string => typeof value === "string" && Boolean(value.trim()),
    )
    : [];

  return {
    ...playletConfig,
    playlet: {
      ...rawPlaylet,
      aiContent,
      aiProductionProofFiles,
    },
  };
}

function validatePlayletConfig(playletConfig: Config, contractSubject?: string): Config {
  const normalizedConfig = normalizeWechatAiContent(playletConfig);
  if (!normalizedConfig.originalTitle) throw new Error("data.originalTitle is required");
  if (!normalizedConfig.playlet?.name) throw new Error("data.playlet.name is required");
  if (!normalizedConfig.playlet.summary) throw new Error("data.playlet.summary is required");
  if (!normalizedConfig.playlet.episodeCount) throw new Error("data.playlet.episodeCount is required");
  const productionProofFileCount = normalizedConfig.playlet.copyright?.productionProofFiles?.filter(Boolean).length ?? 0;
  const isMingxingshuo = Boolean(
    contractSubject
    && normalizeContractSubject(contractSubject) === mingxingshuoContractSubject,
  );
  if (!isMingxingshuo && productionProofFileCount < 1) {
    throw new Error("data.playlet.copyright.productionProofFiles must contain at least 1 contract file.");
  }

  return normalizedConfig;
}

function parseDataJson(dataJson: unknown): Config {
  if (typeof dataJson === "string") {
    return JSON.parse(dataJson) as Config;
  }
  if (typeof dataJson === "object" && dataJson !== null) {
    return dataJson as Config;
  }
  throw new Error("dramaAiRpa detail response data.dataJson is required.");
}

export function normalizeClaimedTaskConfig(task: ClaimedAccountTask, contractSubject?: string): Config {
  const taskPlaylet = task.playlet as Config["playlet"] & Partial<Config>;
  const playlet = {
    ...taskPlaylet,
    name: task.originalTitle,
    dramaType: taskPlaylet.dramaType === "漫剧" ? "漫剧" : "数字真人",
  };
  const videoAccountConfig = (task.videoAccountConfig ?? {}) as Partial<Config>;
  const accountTask = (task.accountTask ?? {}) as Partial<Config>;

  return validatePlayletConfig({
    ...(videoAccountConfig as object),
    ...(accountTask as object),
    originalTitle: task.originalTitle,
    playlet,
  } as Config, contractSubject);
}

export async function loadConfigFromDramaAiRpa(id: string): Promise<Config> {
  const payload = await fetchDramaAiRpaDetailApi(id);
  return validatePlayletConfig(parseDataJson(payload.data?.dataJson));
}
