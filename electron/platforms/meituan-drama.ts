import { app, ipcMain } from "electron";
import Store from "electron-store";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  directoryDefaultPath,
  normalizePlatformRunDataDir,
  openExistingPath,
  playwrightBrowsersPath,
  resolveFromAppRoot,
  RuntimeController,
  selectDirectory,
} from "./shared";
import type { MeituanCreationTaskConfig } from "@drama/meituan-drama-automation";

type MeituanCreationRuntimeStatus = {
  platform: "meituan-drama";
  loginUrl: string;
  publishVideoUrl: string;
  running: boolean;
  loginState: "login-required" | "logged-in" | "unknown";
  activeUrl?: string;
  userDataDir: string;
};

type MeituanCreationRuntime = {
  getStatus: () => MeituanCreationRuntimeStatus;
  stop: () => Promise<void>;
};

export type MeituanCreationConfig = {
  headless: string;
  operationDelaySeconds: string;
  localEpisodeVideoRoot: string;
  runDataDir: string;
};

export type MeituanCreationServiceStatus = MeituanCreationRuntimeStatus & {
  pid: number | null;
};

type MeituanCreationConfigResult = {
  config: MeituanCreationConfig;
  path: string;
  restartRequired: boolean;
};

type MeituanCreationStore = {
  config: Partial<MeituanCreationConfig> & Record<string, string | undefined>;
};

function loadMeituanCreationTaskPayload(): MeituanCreationTaskConfig {
  return {
    authorNicknameText: "本人 明星说漫剧",
    audience: "男频",
    collectionType: "真人短剧（含AI）",
    collectionSubType: "真人短剧",
    collectionTitle: "公司破产当天，底层审核员成了华尔街之神",
    collectionCoverUrl:
      "https://misu-launch-lianshan-beijing-final.tos-cn-beijing.volces.com/drama-ai-rpa/posters/20260624/account-task-467-cdb0070978d442f7843b0af6ecd4ba7d.jpg",
    copyrightProofUrl:
      "https://misu-launch-lianshan-beijing-final.tos-cn-beijing.volces.com/drama-ai-rpa/contracts/20260625/account-task-399-77a496762b62472981521c1e7c6eb488.png",
    premiereProofUrl:
      "https://misu-launch-lianshan-beijing-final.tos-cn-beijing.volces.com/drama-ai-rpa/contracts/20260625/account-task-399-77a496762b62472981521c1e7c6eb488.png",
    backgroundText: "现代",
    plotSettingTexts: ["打脸虐渣", "重生"],
    storyThemeText: "脑洞",
    totalEpisodes: 12,
    checkpointEpisodes: [6, 5],
    productionCompanyText: "明星说漫剧",
    directorNames: ["张三"],
    producerNames: ["李四"],
    screenwriterNames: ["王五"],
    actorNames: ["赵六", "钱七"],
    averageEpisodeDurationMinutes: 2,
    plotSynopsisText: "该剧讲述主角历经困境后逆袭成长，揭开真相并收获亲情与爱情的故事。",
    premiereStatus: "美团联合首发",
    expectedPremiereTimeText: "2026-06-25 12:30:00",
  };
}

const defaultMeituanCreationConfig: MeituanCreationConfig = {
  headless: "false",
  operationDelaySeconds: "0.02",
  localEpisodeVideoRoot: "",
  runDataDir: ".drama-runs/meituan-drama",
};

const runtimeController = new RuntimeController<MeituanCreationRuntime>();
let store: Store<MeituanCreationStore> | null = null;

export function getMeituanCreationBrowserInstanceCount() {
  return runtimeController.current?.getStatus().running ? 1 : 0;
}

export function getMeituanCreationRunningPlatformCount() {
  return runtimeController.current?.getStatus().running ? 1 : 0;
}

export function getMeituanCreationPlatformRuntimeSummary() {
  const runtimeStatus = runtimeController.current?.getStatus();
  const running = Boolean(runtimeStatus?.running);

  return {
    platform: "meituan-drama" as const,
    running,
    browserInstanceCount: running ? 1 : 0,
    browserInstances: running
      ? [{
          id: "default",
          label: "美团创作平台",
          loginState: runtimeStatus?.loginState ?? "unknown",
          activeUrl: runtimeStatus?.activeUrl,
        }]
      : [],
    logDir: meituanCreationLogDir(),
  };
}

export function openMeituanCreationLogDir() {
  const logDir = meituanCreationLogDir();
  mkdirSync(logDir, { recursive: true });
  return openExistingPath(logDir);
}

function getStore() {
  if (!store) {
    store = new Store<MeituanCreationStore>({
      name: "meituan-drama-config",
      defaults: {
        config: defaultMeituanCreationConfig,
      },
    });
  }

  return store;
}

function normalizeConfig(
  config: Partial<MeituanCreationConfig> & Record<string, string | undefined>,
) {
  const legacySlowMo = Number.parseFloat(config.slowMo ?? "");
  const operationDelaySeconds =
    config.operationDelaySeconds ??
    (Number.isFinite(legacySlowMo) ? String(legacySlowMo / 1000) : undefined) ??
    defaultMeituanCreationConfig.operationDelaySeconds;

  return {
    headless: config.headless ?? defaultMeituanCreationConfig.headless,
    operationDelaySeconds,
    localEpisodeVideoRoot:
      config.localEpisodeVideoRoot ?? defaultMeituanCreationConfig.localEpisodeVideoRoot,
    runDataDir:
      !config.runDataDir || config.runDataDir === ".drama-runs"
        ? defaultMeituanCreationConfig.runDataDir
        : config.runDataDir,
  };
}

function readConfig(): MeituanCreationConfig {
  return normalizeConfig(getStore().get("config"));
}

function writeConfig(config: MeituanCreationConfig) {
  getStore().set("config", config);
}

function configPath() {
  return getStore().path;
}

async function defaultStoppedStatus(): Promise<MeituanCreationServiceStatus> {
  const userDataDir = meituanCreationUserDataDir();

  return {
    platform: "meituan-drama",
    loginUrl: "https://czz.meituan.com/new/login",
    publishVideoUrl: "https://czz.meituan.com/new/publishVideo",
    running: false,
    loginState: "unknown",
    userDataDir,
    pid: null,
  };
}

async function status(): Promise<MeituanCreationServiceStatus> {
  const runtime = runtimeController.current;
  if (!runtime) return defaultStoppedStatus();

  const runtimeStatus = runtime.getStatus();
  if (!runtimeStatus.running) {
    await runtimeController.stop();
    return defaultStoppedStatus();
  }

  return {
    ...runtimeStatus,
    pid: process.pid,
  };
}

function meituanCreationRunDataDir(config = readConfig()) {
  return resolveFromAppRoot(config.runDataDir);
}

function meituanCreationLogDir(config = readConfig()) {
  return path.join(meituanCreationRunDataDir(config), "logs");
}

function meituanCreationUserDataDir() {
  return path.join(meituanCreationRunDataDir(), "auth", "chromium-profile");
}

function meituanCreationCredentialStatePath() {
  return path.join(meituanCreationRunDataDir(), "auth", "storage-state.json");
}

function meituanCreationAssetDownloadDir() {
  return path.join(meituanCreationRunDataDir(), "remote-upload-assets", "covers");
}

async function startRuntime() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = playwrightBrowsersPath();

  const config = readConfig();
  const taskPayload = loadMeituanCreationTaskPayload();
  const operationDelayMs = Math.max(0, Number.parseFloat(config.operationDelaySeconds) || 0) * 1000;
  const runtimePackage = "@drama/meituan-drama-automation";
  const { startMeituanCreationRuntime } = await import(/* @vite-ignore */ runtimePackage);
  return startMeituanCreationRuntime({
    userDataDir: meituanCreationUserDataDir(),
    credentialStatePath: meituanCreationCredentialStatePath(),
    assetDownloadDir: meituanCreationAssetDownloadDir(),
    onLog: (message: string) => {
      console.log(message);
    },
    config: {
      ...taskPayload,
      localEpisodeVideoRoot: config.localEpisodeVideoRoot,
      browser: {
        headless: config.headless === "true",
        slowMo: operationDelayMs,
      },
    },
  });
}

export function registerMeituanCreationPlatformHandlers() {
  ipcMain.handle("meituan-drama:config:get", () => ({
    config: readConfig(),
    path: configPath(),
    restartRequired: false,
  }));

  ipcMain.handle(
    "meituan-drama:config:save",
    (_event, config: MeituanCreationConfig): MeituanCreationConfigResult => {
      const nextConfig = normalizeConfig(config);
      writeConfig(nextConfig);
      return {
        config: nextConfig,
        path: configPath(),
        restartRequired: runtimeController.running || runtimeController.startingPromise !== null,
      };
    },
  );

  ipcMain.handle(
    "meituan-drama:config:select-local-episode-video-root",
    async (event, currentPath?: string) => {
      return selectDirectory(event, {
        title: "选择美团剧集视频目录",
        defaultPath: directoryDefaultPath(currentPath, app.getPath("videos")),
        properties: ["openDirectory", "createDirectory"],
      });
    },
  );

  ipcMain.handle(
    "meituan-drama:config:select-run-data-dir",
    async (event, currentPath?: string) => {
      const selectedPath = await selectDirectory(event, {
        title: "选择美团创作平台运行数据目录",
        defaultPath: directoryDefaultPath(currentPath, app.getPath("documents")),
        properties: ["openDirectory", "createDirectory"],
      });

      return normalizePlatformRunDataDir(selectedPath, "meituan-drama");
    },
  );

  ipcMain.handle("meituan-drama:service:status", () => status());

  ipcMain.handle("meituan-drama:service:start", async () => {
    const runtime = runtimeController.current;
    if (runtime && !runtime.getStatus().running) {
      await runtimeController.stop();
    }

    await runtimeController.start(startRuntime);
    return status();
  });

  ipcMain.handle("meituan-drama:service:stop", async () => {
    await runtimeController.stop();
    return status();
  });
}

export function stopMeituanCreationPlatformRuntime() {
  runtimeController.stopInBackground();
}
