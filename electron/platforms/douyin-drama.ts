import { app, ipcMain } from "electron";
import Store from "electron-store";
import { existsSync, mkdirSync, statSync } from "node:fs";
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
import { ensureBaiduNetdiskShareDownloaded } from "./baidu-netdisk";

type DouyinDramaRuntimeStatus = {
  platform: "douyin-drama";
  running: boolean;
  loginState: "login-required" | "logged-in" | "unknown";
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

type DouyinDramaRuntime = {
  getStatus: () => DouyinDramaRuntimeStatus;
  stop: () => Promise<void>;
};

export type DouyinDramaConfig = {
  accountProfileName: string;
  apiBaseUrl: string;
  useMockTask: string;
  localEpisodeVideoRoot: string;
  baiduNetdiskDownloadRetryAttempts: string;
  episodeUploadWaitTimeoutMinutes: string;
  headless: string;
  operationDelaySeconds: string;
  taskPollIntervalSeconds: string;
  runDataDir: string;
  logRetentionDays: string;
};

type DouyinDramaStoragePaths = {
  runDataDir: string;
  accountDir: string;
  userDataDir: string;
  credentialStatePath: string;
  assetDownloadDir: string;
  logDir: string;
  logFilePath: string;
};

export type DouyinDramaServiceStatus = DouyinDramaRuntimeStatus & { pid: number | null };
type DouyinDramaStore = { config: Partial<DouyinDramaConfig> };

const defaultConfig: DouyinDramaConfig = {
  accountProfileName: "default",
  apiBaseUrl: "",
  useMockTask: "false",
  localEpisodeVideoRoot: "",
  baiduNetdiskDownloadRetryAttempts: "3",
  episodeUploadWaitTimeoutMinutes: "120",
  headless: "false",
  operationDelaySeconds: "0",
  taskPollIntervalSeconds: "10",
  runDataDir: "D:\\.drama-runs\\douyin-drama",
  logRetentionDays: "3",
};

const runtimeController = new RuntimeController<DouyinDramaRuntime>();
let store: Store<DouyinDramaStore> | null = null;

function getStore() {
  store ??= new Store<DouyinDramaStore>({
    name: "douyin-drama-config",
    defaults: { config: defaultConfig },
  });
  return store;
}

function numberText(value: string | undefined, fallback: string, minimum: number) {
  const number = Number.parseFloat(value ?? "");
  return Number.isFinite(number) && number >= minimum ? String(value).trim() : fallback;
}

function normalizeConfig(config: Partial<DouyinDramaConfig>): DouyinDramaConfig {
  return {
    accountProfileName: config.accountProfileName?.trim() || defaultConfig.accountProfileName,
    apiBaseUrl: config.apiBaseUrl?.trim() ?? "",
    useMockTask: config.useMockTask === "true" ? "true" : "false",
    localEpisodeVideoRoot: config.localEpisodeVideoRoot?.trim() ?? "",
    baiduNetdiskDownloadRetryAttempts: numberText(
      config.baiduNetdiskDownloadRetryAttempts,
      defaultConfig.baiduNetdiskDownloadRetryAttempts,
      0,
    ),
    episodeUploadWaitTimeoutMinutes: numberText(
      config.episodeUploadWaitTimeoutMinutes,
      defaultConfig.episodeUploadWaitTimeoutMinutes,
      1,
    ),
    headless: config.headless === "true" ? "true" : "false",
    operationDelaySeconds: numberText(
      config.operationDelaySeconds,
      defaultConfig.operationDelaySeconds,
      0,
    ),
    taskPollIntervalSeconds: numberText(
      config.taskPollIntervalSeconds,
      defaultConfig.taskPollIntervalSeconds,
      1,
    ),
    runDataDir: config.runDataDir?.trim() || defaultConfig.runDataDir,
    logRetentionDays: numberText(config.logRetentionDays, defaultConfig.logRetentionDays, 1),
  };
}

function readConfig() {
  return normalizeConfig(getStore().get("config"));
}

function storagePaths(config = readConfig()): DouyinDramaStoragePaths {
  const runDataDir = resolveFromAppRoot(config.runDataDir);
  const accountDir = path.join(
    runDataDir,
    "auth",
    "accounts",
    encodeURIComponent(config.accountProfileName),
  );
  const logDir = path.join(runDataDir, "logs");
  const now = new Date();
  const dateKey = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return {
    runDataDir,
    accountDir,
    userDataDir: path.join(accountDir, "chromium-profile"),
    credentialStatePath: path.join(accountDir, "storage-state.json"),
    assetDownloadDir: path.join(runDataDir, "assets", encodeURIComponent(config.accountProfileName)),
    logDir,
    logFilePath: path.join(logDir, `app-${dateKey}.jsonl`),
  };
}

function ensureStorageDirectories(paths = storagePaths()) {
  for (const target of [
    paths.runDataDir,
    paths.accountDir,
    paths.userDataDir,
    paths.assetDownloadDir,
    paths.logDir,
  ]) {
    mkdirSync(target, { recursive: true });
  }
}

async function defaultStoppedStatus(): Promise<DouyinDramaServiceStatus> {
  const paths = storagePaths();
  return {
    platform: "douyin-drama",
    running: false,
    loginState: "unknown",
    createUrl:
      "https://www.shortdramas.com/page/copyright/short-play/motion-comic-manage-edit-page/?from=book",
    loginUrl:
      "https://www.shortdramas.com/page/login?redirect=%2Fcopyright%2Fshort-play%2Fmotion-comic-manage-edit-page%2F%3Ffrom%3Dbook",
    userDataDir: paths.userDataDir,
    pid: null,
  };
}

async function status(): Promise<DouyinDramaServiceStatus> {
  const runtime = runtimeController.current;
  return runtime ? { ...runtime.getStatus(), pid: process.pid } : defaultStoppedStatus();
}

async function startRuntime() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = playwrightBrowsersPath();
  const config = readConfig();
  const configuredVideoRoot = config.localEpisodeVideoRoot.trim();
  if (!configuredVideoRoot) {
    throw new Error("请先在抖音短剧配置中选择剧集视频根目录，再启动服务。");
  }
  const localEpisodeVideoRoot = resolveFromAppRoot(configuredVideoRoot);
  if (!existsSync(localEpisodeVideoRoot) || !statSync(localEpisodeVideoRoot).isDirectory()) {
    throw new Error(`抖音短剧剧集视频根目录不存在或不是文件夹：${localEpisodeVideoRoot}`);
  }
  const paths = storagePaths(config);
  ensureStorageDirectories(paths);
  const { startDouyinDramaRuntime } = await import("@drama/douyin-drama-automation") as {
    startDouyinDramaRuntime: (options: Record<string, unknown>) => Promise<DouyinDramaRuntime>;
  };
  return startDouyinDramaRuntime({
    accountProfileName: config.accountProfileName,
    apiBaseUrl: config.apiBaseUrl,
    mockTaskEnabled: config.useMockTask === "true",
    userDataDir: paths.userDataDir,
    credentialStatePath: paths.credentialStatePath,
    assetDownloadDir: paths.assetDownloadDir,
    logFilePath: paths.logFilePath,
    logRetentionDays: Number.parseInt(config.logRetentionDays, 10),
    localEpisodeVideoRoot,
    baiduNetdiskDownloadRetryAttempts: Number.parseInt(
      config.baiduNetdiskDownloadRetryAttempts,
      10,
    ),
    episodeUploadWaitTimeoutMinutes: Number.parseFloat(config.episodeUploadWaitTimeoutMinutes),
    taskPollIntervalMs: Number.parseFloat(config.taskPollIntervalSeconds) * 1_000,
    ensureBaiduNetdiskResource: ensureBaiduNetdiskShareDownloaded,
    onLog: (message: string) => console.log(message),
    config: {
      browser: {
        headless: config.headless === "true",
        slowMo: Number.parseFloat(config.operationDelaySeconds) * 1_000,
      },
    },
  });
}

export function getDouyinDramaBrowserInstanceCount() {
  return runtimeController.current?.getStatus().running ? 1 : 0;
}

export function getDouyinDramaRunningPlatformCount() {
  return runtimeController.current?.getStatus().running ? 1 : 0;
}

export function getDouyinDramaPlatformRuntimeSummary() {
  const runtime = runtimeController.current?.getStatus();
  return {
    platform: "douyin-drama" as const,
    running: Boolean(runtime?.running),
    browserInstanceCount: runtime?.running ? 1 : 0,
    browserInstances: runtime?.running
      ? [{ id: "default", label: "抖音短剧", loginState: runtime.loginState, activeUrl: runtime.activeUrl }]
      : [],
    logDir: storagePaths().logDir,
  };
}

export function openDouyinDramaLogDir() {
  const paths = storagePaths();
  mkdirSync(paths.logDir, { recursive: true });
  return openExistingPath(paths.logDir);
}

export function registerDouyinDramaPlatformHandlers() {
  ipcMain.handle("douyin-drama:config:get", () => ({
    config: readConfig(),
    path: getStore().path,
    storagePaths: storagePaths(),
    restartRequired: false,
  }));
  ipcMain.handle("douyin-drama:config:save", (_event, config: DouyinDramaConfig) => {
    const nextConfig = normalizeConfig(config);
    getStore().set("config", nextConfig);
    return {
      config: nextConfig,
      path: getStore().path,
      storagePaths: storagePaths(nextConfig),
      restartRequired: runtimeController.running || runtimeController.startingPromise !== null,
    };
  });
  ipcMain.handle("douyin-drama:config:select-run-data-dir", async (event, currentPath?: string) => {
    const selected = await selectDirectory(event, {
      title: "选择抖音短剧运行数据目录",
      defaultPath: directoryDefaultPath(currentPath, app.getPath("documents")),
      properties: ["openDirectory", "createDirectory"],
    });
    return normalizePlatformRunDataDir(selected, "douyin-drama");
  });
  ipcMain.handle(
    "douyin-drama:config:select-local-episode-video-root",
    (event, currentPath?: string) => selectDirectory(event, {
      title: "选择抖音短剧剧集视频根目录",
      defaultPath: directoryDefaultPath(currentPath, app.getPath("videos")),
      properties: ["openDirectory", "createDirectory"],
    }),
  );
  ipcMain.handle("douyin-drama:service:status", () => status());
  ipcMain.handle("douyin-drama:service:start", async () => {
    await runtimeController.start(startRuntime);
    return status();
  });
  ipcMain.handle("douyin-drama:service:stop", async () => {
    await runtimeController.stop();
    return status();
  });
}

export function stopDouyinDramaPlatformRuntime() {
  runtimeController.stopInBackground();
}
