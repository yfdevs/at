import path from "node:path";
import { getWechatVideoRuntimeSettings } from "./runtime-settings.js";
import { numberSetting, secondsSettingToMs } from "./settings-value.js";
import type { ClaimedAccountTask, Config } from "./types.js";
import { fetchDramaAiRpaDetailApi } from "../api/drama-ai-rpa.js";
import { fetchVideoAccountsApi, type VideoAccount } from "../api/video-accounts.js";

const serviceAuthRoot = ".drama-runs/wechat-video/auth/channels";
const serviceBrowserHeadless = false;
const serviceBrowserSlowMo = 20;
const emptyClaimDelaySeconds = 5;
const slowEmptyClaimThreshold = 10;
const slowEmptyClaimDelaySeconds = 30;
const videoAccountSyncIntervalSeconds = 60;
const idlePageRefreshIntervalSeconds = 1500;
const idlePageRefreshTimeoutSeconds = 60;
const idlePageRefreshJitterSeconds = 300;

function parseContractSubjects(setting: string): Set<string> {
  return new Set(
    setting
      .split(",")
      .map((subject) => subject.trim())
      .filter(Boolean),
  );
}

export function filterVideoAccountsByContractSubjects(
  videoAccounts: VideoAccount[],
  contractSubjectsSetting = getWechatVideoRuntimeSettings().videoAccountContractSubjects,
): VideoAccount[] {
  const contractSubjects = parseContractSubjects(contractSubjectsSetting);

  return videoAccounts.filter((account) => (
    account.contractSubject ? contractSubjects.has(account.contractSubject) : false
  ));
}

export function resolveFromRoot(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

export function resolveRunDataPath(...segments: string[]): string {
  const runDataDir = getWechatVideoRuntimeSettings().runDataDir || ".drama-runs/wechat-video";
  return path.join(resolveFromRoot(runDataDir), ...segments);
}

export interface ServiceConfig {
  videoAccounts: VideoAccount[];
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
  const videoAccounts = filterVideoAccountsByContractSubjects(await fetchVideoAccountsApi(), settings.videoAccountContractSubjects);
  const accountIds = videoAccounts.map((account) => account.id);

  if (videoAccounts.length === 0) {
    throw new Error("Video account list must contain at least one account.");
  }
  if (new Set(accountIds).size !== accountIds.length) {
    throw new Error("Video account list must not contain duplicate account ids.");
  }
  if (videoAccounts.some((account) => !account.id || !account.name)) {
    throw new Error("Video account id and name are required.");
  }

  return {
    videoAccounts,
    authRoot: serviceAuthRoot,
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
  if (productionProofFileCount < 2) {
    throw new Error("data.playlet.copyright.productionProofFiles must contain at least 2 files.");
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
