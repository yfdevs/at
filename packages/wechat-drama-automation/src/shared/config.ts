import path from "node:path";
import { getWechatVideoRuntimeSettings } from "./runtime-settings.js";
import { numberSetting, secondsSettingToMs } from "./settings-value.js";
import type { ClaimedAccountTask, Config } from "./types.js";
import { fetchDramaAiRpaDetailApi } from "../api/drama-ai-rpa.js";
import { fetchVideoAccountsApi, type VideoAccount } from "../api/video-accounts.js";

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
};
// 兼容后端历史数据：contractSubject=0 表示未写入有效主体枚举，精确匹配不到时兜底使用。
const legacyUnscopedContractSubjects = new Set(["0"]);

function normalizeContractSubject(value: string): string {
  const trimmedValue = value.trim();
  return contractSubjectAliases[trimmedValue] ?? trimmedValue.toUpperCase();
}

function isLegacyUnscopedContractSubject(value: string | undefined): boolean {
  return value ? legacyUnscopedContractSubjects.has(value.trim()) : false;
}

function parseContractSubjects(setting: string): Set<string> {
  return new Set(
    setting
      .split(",")
      .map(normalizeContractSubject)
      .filter(Boolean),
  );
}

export function filterVideoAccountsByContractSubjects(
  videoAccounts: VideoAccount[],
  contractSubjectsSetting = getWechatVideoRuntimeSettings().videoAccountContractSubjects,
): VideoAccount[] {
  const contractSubjects = parseContractSubjects(contractSubjectsSetting);
  const matchedAccounts = videoAccounts.filter((account) => (
    account.contractSubject ? contractSubjects.has(normalizeContractSubject(account.contractSubject)) : false
  ));

  if (matchedAccounts.length > 0) {
    return matchedAccounts;
  }

  const legacyUnscopedAccounts = videoAccounts.filter((account) => (
    isLegacyUnscopedContractSubject(account.contractSubject)
  ));
  if (legacyUnscopedAccounts.length > 0) {
    console.warn("[config] no exact contract subject matches; using legacy unscoped video accounts", {
      selectedContractSubjects: Array.from(contractSubjects),
      legacyUnscopedCount: legacyUnscopedAccounts.length,
    });
  }

  return legacyUnscopedAccounts;
}

function summarizeContractSubjects(videoAccounts: VideoAccount[]): Array<{ raw: string; normalized: string; count: number }> {
  const stats = new Map<string, { raw: string; normalized: string; count: number }>();

  for (const account of videoAccounts) {
    const raw = account.contractSubject?.trim() || "-";
    const normalized = raw === "-" ? "-" : normalizeContractSubject(raw);
    const key = `${raw}\u0000${normalized}`;
    const current = stats.get(key);
    if (current) {
      current.count += 1;
    } else {
      stats.set(key, { raw, normalized, count: 1 });
    }
  }

  return Array.from(stats.values());
}

export function resolveFromRoot(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

export function resolveRunDataPath(...segments: string[]): string {
  const runDataDir = getWechatVideoRuntimeSettings().runDataDir || ".drama-runs/wechat-drama";
  return path.join(resolveFromRoot(runDataDir), ...segments);
}

export interface ServiceConfig {
  videoAccounts: VideoAccount[];
  videoAccountContractSubjects: string;
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
  const settings = getWechatVideoRuntimeSettings();
  const allVideoAccounts = await fetchVideoAccountsApi();
  const videoAccounts = filterVideoAccountsByContractSubjects(allVideoAccounts, settings.videoAccountContractSubjects);
  const accountIds = videoAccounts.map((account) => account.id);
  console.log("[config] fetched video accounts", {
    selectedContractSubjects: settings.videoAccountContractSubjects,
    totalCount: allVideoAccounts.length,
    filteredCount: videoAccounts.length,
    contractSubjectStats: summarizeContractSubjects(allVideoAccounts),
  });

  if (videoAccounts.length === 0) {
    const availableContractSubjects = Array.from(new Set(
      allVideoAccounts.map((account) => account.contractSubject?.trim()).filter(Boolean),
    ));
    throw new Error(`Video account list must contain at least one account after contract subject filter: ${settings.videoAccountContractSubjects}; available contract subjects: ${availableContractSubjects.join(", ") || "-"}`);
  }
  if (new Set(accountIds).size !== accountIds.length) {
    throw new Error("Video account list must not contain duplicate account ids.");
  }
  if (videoAccounts.some((account) => !account.id || !account.name)) {
    throw new Error("Video account id and name are required.");
  }

  return {
    videoAccounts,
    videoAccountContractSubjects: settings.videoAccountContractSubjects,
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

function validatePlayletConfig(playletConfig: Config): Config {
  if (!playletConfig.originalTitle) throw new Error("data.originalTitle is required");
  if (!playletConfig.playlet?.name) throw new Error("data.playlet.name is required");
  if (!playletConfig.playlet.summary) throw new Error("data.playlet.summary is required");
  if (!playletConfig.playlet.episodeCount) throw new Error("data.playlet.episodeCount is required");
  const productionProofFileCount = playletConfig.playlet.copyright?.productionProofFiles?.filter(Boolean).length ?? 0;
  if (productionProofFileCount < 1) {
    throw new Error("data.playlet.copyright.productionProofFiles must contain at least 1 contract file.");
  }

  return playletConfig;
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

export function normalizeClaimedTaskConfig(task: ClaimedAccountTask): Config {
  const playlet = task.playlet as Config["playlet"] & Partial<Config>;
  const videoAccountConfig = (task.videoAccountConfig ?? {}) as Partial<Config>;
  const accountTask = (task.accountTask ?? {}) as Partial<Config>;

  return validatePlayletConfig({
    ...(videoAccountConfig as object),
    ...(accountTask as object),
    originalTitle: task.originalTitle,
    playlet,
  } as Config);
}

export async function loadConfigFromDramaAiRpa(id: string): Promise<Config> {
  const payload = await fetchDramaAiRpaDetailApi(id);
  return validatePlayletConfig(parseDataJson(payload.data?.dataJson));
}
