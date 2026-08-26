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

type BaiduDramaRuntimeStatus = {
  platform: "baidu-drama";
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

type BaiduDramaRuntime = {
  getStatus: () => BaiduDramaRuntimeStatus;
  stop: () => Promise<void>;
};

export type BaiduDramaConfig = {
  accountProfileName: string;
  localEpisodeVideoRoot: string;
  baiduNetdiskDownloadRetryAttempts: string;
  episodeUploadWaitTimeoutMinutes: string;
  headless: string;
  operationDelaySeconds: string;
  taskPollIntervalSeconds: string;
  runDataDir: string;
};

type BaiduDramaStoragePaths = {
  runDataDir: string;
  accountDir: string;
  userDataDir: string;
  credentialStatePath: string;
  assetDownloadDir: string;
  logDir: string;
  logFilePath: string;
};

export type BaiduDramaServiceStatus = BaiduDramaRuntimeStatus & { pid: number | null };
type BaiduDramaStore = { config: Partial<BaiduDramaConfig> };

const defaultConfig: BaiduDramaConfig = {
  accountProfileName: "default",
  localEpisodeVideoRoot: "",
  baiduNetdiskDownloadRetryAttempts: "3",
  episodeUploadWaitTimeoutMinutes: "120",
  headless: "false",
  operationDelaySeconds: "0",
  taskPollIntervalSeconds: "10",
  runDataDir: "D:\\.drama-runs\\baidu-drama",
};

const runtimeController = new RuntimeController<BaiduDramaRuntime>();
let store: Store<BaiduDramaStore> | null = null;

function getStore() {
  store ??= new Store<BaiduDramaStore>({
    name: "baidu-drama-config",
    defaults: { config: defaultConfig },
  });
  return store;
}

function numberText(value: string | undefined, fallback: string, minimum: number) {
  const number = Number.parseFloat(value ?? "");
  return Number.isFinite(number) && number >= minimum ? String(value).trim() : fallback;
}

function normalizeConfig(config: Partial<BaiduDramaConfig>): BaiduDramaConfig {
  return {
    accountProfileName: config.accountProfileName?.trim() || defaultConfig.accountProfileName,
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
    headless: config.headless ?? defaultConfig.headless,
    operationDelaySeconds: numberText(config.operationDelaySeconds, defaultConfig.operationDelaySeconds, 0),
    taskPollIntervalSeconds: numberText(config.taskPollIntervalSeconds, defaultConfig.taskPollIntervalSeconds, 1),
    runDataDir: config.runDataDir?.trim() || defaultConfig.runDataDir,
  };
}

function readConfig() {
  return normalizeConfig(getStore().get("config"));
}

function storagePaths(config = readConfig()): BaiduDramaStoragePaths {
  const runDataDir = resolveFromAppRoot(config.runDataDir);
  const accountDir = path.join(runDataDir, "auth", "accounts", encodeURIComponent(config.accountProfileName));
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
  for (const target of [paths.runDataDir, paths.accountDir, paths.userDataDir, paths.assetDownloadDir, paths.logDir]) {
    mkdirSync(target, { recursive: true });
  }
}

async function defaultStoppedStatus(): Promise<BaiduDramaServiceStatus> {
  const paths = storagePaths();
  return {
    platform: "baidu-drama",
    running: false,
    loginState: "unknown",
    createUrl: "https://duanju.baidu.com/builder/rc/edit?type=playlet&sub_type=create_playlet_type&action=new",
    loginUrl: "https://duanju.baidu.com/builder/theme/playletPlat/product",
    userDataDir: paths.userDataDir,
    pid: null,
  };
}

async function status(): Promise<BaiduDramaServiceStatus> {
  const runtime = runtimeController.current;
  return runtime ? { ...runtime.getStatus(), pid: process.pid } : defaultStoppedStatus();
}

async function startRuntime() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = playwrightBrowsersPath();
  const config = readConfig();
  const configuredVideoRoot = config.localEpisodeVideoRoot.trim();
  if (!configuredVideoRoot) {
    throw new Error("请先在百度短剧配置中选择剧集视频根目录，再启动服务。");
  }
  const localEpisodeVideoRoot = resolveFromAppRoot(configuredVideoRoot);
  if (!existsSync(localEpisodeVideoRoot) || !statSync(localEpisodeVideoRoot).isDirectory()) {
    throw new Error(`百度短剧剧集视频根目录不存在或不是文件夹：${localEpisodeVideoRoot}`);
  }
  const paths = storagePaths(config);
  ensureStorageDirectories(paths);
  const { startBaiduDramaRuntime } = await import("@drama/baidu-drama-automation") as {
    startBaiduDramaRuntime: (options: Record<string, unknown>) => Promise<BaiduDramaRuntime>;
  };
  return startBaiduDramaRuntime({
    accountProfileName: config.accountProfileName,
    userDataDir: paths.userDataDir,
    credentialStatePath: paths.credentialStatePath,
    assetDownloadDir: paths.assetDownloadDir,
    logFilePath: paths.logFilePath,
    localEpisodeVideoRoot,
    baiduNetdiskDownloadRetryAttempts: Number.parseInt(config.baiduNetdiskDownloadRetryAttempts, 10),
    episodeUploadWaitTimeoutMinutes: Number.parseFloat(config.episodeUploadWaitTimeoutMinutes),
    taskPollIntervalMs: Number.parseFloat(config.taskPollIntervalSeconds) * 1000,
    ensureBaiduNetdiskResource: ensureBaiduNetdiskShareDownloaded,
    onLog: (message: string) => console.log(message),
    config: {
      browser: {
        headless: config.headless === "true",
        slowMo: Number.parseFloat(config.operationDelaySeconds) * 1000,
      },
    },
  });
}

export function getBaiduDramaBrowserInstanceCount() {
  return runtimeController.current?.getStatus().running ? 1 : 0;
}

export function getBaiduDramaRunningPlatformCount() {
  return runtimeController.current?.getStatus().running ? 1 : 0;
}

export function getBaiduDramaPlatformRuntimeSummary() {
  const runtime = runtimeController.current?.getStatus();
  return {
    platform: "baidu-drama" as const,
    running: Boolean(runtime?.running),
    browserInstanceCount: runtime?.running ? 1 : 0,
    browserInstances: runtime?.running
      ? [{ id: "default", label: "百度短剧", loginState: runtime.loginState, activeUrl: runtime.activeUrl }]
      : [],
    logDir: storagePaths().logDir,
  };
}

export function openBaiduDramaLogDir() {
  const paths = storagePaths();
  mkdirSync(paths.logDir, { recursive: true });
  return openExistingPath(paths.logDir);
}

export function registerBaiduDramaPlatformHandlers() {
  ipcMain.handle("baidu-drama:config:get", () => ({
    config: readConfig(),
    path: getStore().path,
    storagePaths: storagePaths(),
    restartRequired: false,
  }));
  ipcMain.handle("baidu-drama:config:save", (_event, config: BaiduDramaConfig) => {
    const nextConfig = normalizeConfig(config);
    getStore().set("config", nextConfig);
    return {
      config: nextConfig,
      path: getStore().path,
      storagePaths: storagePaths(nextConfig),
      restartRequired: runtimeController.running || runtimeController.startingPromise !== null,
    };
  });
  ipcMain.handle("baidu-drama:config:select-run-data-dir", async (event, currentPath?: string) => {
    const selected = await selectDirectory(event, {
      title: "选择百度短剧运行数据目录",
      defaultPath: directoryDefaultPath(currentPath, app.getPath("documents")),
      properties: ["openDirectory", "createDirectory"],
    });
    return normalizePlatformRunDataDir(selected, "baidu-drama");
  });
  ipcMain.handle("baidu-drama:config:select-local-episode-video-root", (event, currentPath?: string) =>
    selectDirectory(event, {
      title: "选择百度短剧剧集视频根目录",
      defaultPath: directoryDefaultPath(currentPath, app.getPath("videos")),
      properties: ["openDirectory", "createDirectory"],
    }),
  );
  ipcMain.handle("baidu-drama:service:status", () => status());
  ipcMain.handle("baidu-drama:service:start", async () => {
    await runtimeController.start(startRuntime);
    return status();
  });
  ipcMain.handle("baidu-drama:service:stop", async () => {
    await runtimeController.stop();
    return status();
  });
}

export function stopBaiduDramaPlatformRuntime() {
  runtimeController.stopInBackground();
}
