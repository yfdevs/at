import { app, ipcMain } from "electron";
import Store from "electron-store";
import cron, { type ScheduledTask } from "node-cron";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { lstat, readdir, rm, stat } from "node:fs/promises";
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
import { createElectronPlatformLogger } from "../platform-logger";
import {
  assertGlobalDirectoriesConfigured,
  createConfiguredAiClient,
  getConfiguredAiImageModel,
  resolveGlobalPlatformDirectories,
} from "../global-app-config";

type BaiduDramaAccount = {
  id: number;
  accountId: string;
  accountName: string;
  loginAccount?: string | null;
  rpaProfileKey?: string | null;
};

type BaiduDramaAccountRuntimeStatus = {
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

type BaiduDramaAccountRuntime = {
  getStatus: () => BaiduDramaAccountRuntimeStatus;
  stop: () => Promise<void>;
};

type BaiduDramaRuntimeStatus = {
  platform: "baidu-drama";
  running: boolean;
  createUrl: string;
  loginUrl: string;
  accounts: Array<BaiduDramaAccountRuntimeStatus & {
    accountId: string;
    accountName: string;
    loginAccount?: string | null;
    launched: boolean;
  }>;
};

type BaiduDramaRuntime = {
  getStatus: () => BaiduDramaRuntimeStatus;
  stop: () => Promise<void>;
};

export type BaiduDramaConfig = {
  apiBaseUrl: string;
  localEpisodeVideoRoot: string;
  baiduNetdiskDownloadRetryAttempts: string;
  episodeUploadWaitTimeoutMinutes: string;
  headless: string;
  operationDelaySeconds: string;
  taskPollIntervalSeconds: string;
  runDataDir: string;
  logRetentionDays: string;
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
  apiBaseUrl: "http://180.184.76.232:19090",
  localEpisodeVideoRoot: "",
  baiduNetdiskDownloadRetryAttempts: "3",
  episodeUploadWaitTimeoutMinutes: "120",
  headless: "false",
  operationDelaySeconds: "0",
  taskPollIntervalSeconds: "10",
  runDataDir: "D:\\.drama-runs\\baidu-drama",
  logRetentionDays: "3",
};

const runtimeController = new RuntimeController<BaiduDramaRuntime>();
const baiduAiCoverTemporaryFilePattern = /^\.generated-(?:landscape|portrait)-\d+-\d+\.image$/;
const baiduAiCoverTemporaryFileRetentionMs = 24 * 60 * 60 * 1_000;
let store: Store<BaiduDramaStore> | null = null;
let aiCoverTemporaryFileCleanupTask: ScheduledTask | null = null;

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
    apiBaseUrl: config.apiBaseUrl?.trim() || defaultConfig.apiBaseUrl,
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
    logRetentionDays: numberText(config.logRetentionDays, defaultConfig.logRetentionDays, 1),
  };
}

function readConfig() {
  const config = normalizeConfig(getStore().get("config"));
  const directories = resolveGlobalPlatformDirectories("baidu-drama", {
    runDataDir: config.runDataDir,
    localMaterialRoot: config.localEpisodeVideoRoot,
  });
  return {
    ...config,
    runDataDir: directories.runDataDir,
    localEpisodeVideoRoot: directories.localMaterialRoot,
  };
}

function storagePaths(
  config = readConfig(),
  accountProfileName = "default",
): BaiduDramaStoragePaths {
  const runDataDir = resolveFromAppRoot(config.runDataDir);
  const encodedProfileName = encodeURIComponent(accountProfileName.trim() || "default");
  const accountDir = path.join(runDataDir, "auth", "accounts", encodedProfileName);
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
    assetDownloadDir: path.join(runDataDir, "assets", encodedProfileName),
    logDir,
    logFilePath: path.join(logDir, `app-${dateKey}.log`),
  };
}

function baiduDramaPlatformLogger(scope = "runtime") {
  const paths = storagePaths();
  return createElectronPlatformLogger({
    platform: "baidu-drama",
    scope,
    logDir: paths.logDir,
    retentionDays: Number.parseInt(readConfig().logRetentionDays, 10) || 3,
  });
}

function isMissingPathError(error: unknown) {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

async function removeBaiduAiCoverTemporaryFile(file: string) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await rm(file, { force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") return;
      if (!["EBUSY", "EACCES", "EPERM"].includes(code ?? "") || attempt >= 5) throw error;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, attempt * 500);
      });
    }
  }
}

async function cleanupStaleBaiduAiCoverTemporaryFiles(now = new Date()) {
  const assetsRoot = path.resolve(resolveFromAppRoot(readConfig().runDataDir), "assets");
  const cutoffMs = now.getTime() - baiduAiCoverTemporaryFileRetentionMs;
  const accountEntries = await readdir(assetsRoot, { withFileTypes: true }).catch((error: unknown) => {
    if (isMissingPathError(error)) return [];
    throw error;
  });
  let deletedCount = 0;
  let failedCount = 0;

  for (const accountEntry of accountEntries) {
    if (!accountEntry.isDirectory() || accountEntry.isSymbolicLink()) continue;
    const cacheRoot = path.join(assetsRoot, accountEntry.name, "ai-cover-cache");
    const cacheRootStat = await lstat(cacheRoot).catch((error: unknown) => {
      if (isMissingPathError(error)) return undefined;
      throw error;
    });
    if (!cacheRootStat?.isDirectory() || cacheRootStat.isSymbolicLink()) continue;

    const cacheEntries = await readdir(cacheRoot, { withFileTypes: true });
    for (const cacheEntry of cacheEntries) {
      if (!cacheEntry.isDirectory() || cacheEntry.isSymbolicLink()) continue;
      const cacheDirectory = path.join(cacheRoot, cacheEntry.name);
      const entries = await readdir(cacheDirectory, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !baiduAiCoverTemporaryFilePattern.test(entry.name)) continue;
        const file = path.resolve(cacheDirectory, entry.name);
        const relativeFile = path.relative(assetsRoot, file);
        if (!relativeFile || relativeFile.startsWith("..") || path.isAbsolute(relativeFile)) continue;
        const fileStat = await stat(file).catch((error: unknown) => {
          if (isMissingPathError(error)) return undefined;
          throw error;
        });
        if (!fileStat?.isFile() || fileStat.mtimeMs > cutoffMs) continue;

        try {
          await removeBaiduAiCoverTemporaryFile(file);
          deletedCount += 1;
        } catch (error) {
          failedCount += 1;
          baiduDramaPlatformLogger("storage").warn("AI封面临时文件清理失败，已忽略", {
            path: file,
            error,
          });
        }
      }
    }
  }

  baiduDramaPlatformLogger("storage").info("AI封面临时文件清理完成", {
    deletedCount,
    failedCount,
  });
}

function scheduleBaiduAiCoverTemporaryFileCleanup() {
  if (aiCoverTemporaryFileCleanupTask) return;

  const runCleanup = () => cleanupStaleBaiduAiCoverTemporaryFiles().catch((error: unknown) => {
    baiduDramaPlatformLogger("storage").error("AI封面临时文件定时清理失败", { error });
  });
  aiCoverTemporaryFileCleanupTask = cron.schedule("0 1 * * *", runCleanup, {
    name: "baidu-ai-cover-temporary-file-cleanup",
    timezone: "Asia/Shanghai",
    noOverlap: true,
    unref: true,
  });
  void runCleanup();
  baiduDramaPlatformLogger("storage").info("AI封面临时文件定时清理已启用", {
    retention: "24小时",
    schedule: "每天 01:00",
  });
}

function ensureStorageDirectories(paths = storagePaths()) {
  for (const target of [paths.runDataDir, paths.accountDir, paths.userDataDir, paths.assetDownloadDir, paths.logDir]) {
    mkdirSync(target, { recursive: true });
  }
}

async function defaultStoppedStatus(): Promise<BaiduDramaServiceStatus> {
  return {
    platform: "baidu-drama",
    running: false,
    createUrl: "https://duanju.baidu.com/builder/rc/edit?type=playlet&sub_type=create_playlet_type&action=new",
    loginUrl: "https://duanju.baidu.com/builder/theme/playletPlat/product",
    accounts: [],
    pid: null,
  };
}

async function status(): Promise<BaiduDramaServiceStatus> {
  const runtime = runtimeController.current;
  if (!runtime) return defaultStoppedStatus();

  const runtimeStatus = runtime.getStatus();
  if (!runtimeStatus.running) {
    await runtimeController.stop();
    return defaultStoppedStatus();
  }
  return { ...runtimeStatus, pid: process.pid };
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
  const { fetchBaiduDramaAccounts, startBaiduDramaRuntime } = await import("@drama/baidu-drama-automation") as {
    fetchBaiduDramaAccounts: (apiBaseUrl: string) => Promise<BaiduDramaAccount[]>;
    startBaiduDramaRuntime: (options: Record<string, unknown>) => Promise<BaiduDramaAccountRuntime>;
  };
  const accounts = await fetchBaiduDramaAccounts(config.apiBaseUrl);
  if (!accounts.length) throw new Error("BAIDU_DRAMA_ENABLED_ACCOUNT_NOT_FOUND");

  const accountRuntimes: Array<{
    account: BaiduDramaAccount;
    runtime: BaiduDramaAccountRuntime;
  }> = [];
  let running = true;

  try {
    for (const account of accounts) {
      const accountProfileName = account.rpaProfileKey?.trim() || account.accountId;
      const paths = storagePaths(config, accountProfileName);
      ensureStorageDirectories(paths);
      const runtime = await startBaiduDramaRuntime({
        accountProfileName,
        baiduAccountId: account.accountId,
        baiduAccountName: account.accountName,
        userDataDir: paths.userDataDir,
        credentialStatePath: paths.credentialStatePath,
        assetDownloadDir: paths.assetDownloadDir,
        logFilePath: paths.logFilePath,
        logRetentionDays: Number.parseInt(config.logRetentionDays, 10),
        localEpisodeVideoRoot,
        baiduNetdiskDownloadRetryAttempts: Number.parseInt(config.baiduNetdiskDownloadRetryAttempts, 10),
        episodeUploadWaitTimeoutMinutes: Number.parseFloat(config.episodeUploadWaitTimeoutMinutes),
        taskPollIntervalMs: Number.parseFloat(config.taskPollIntervalSeconds) * 1000,
        createAiClient: createConfiguredAiClient,
        aiImageModel: getConfiguredAiImageModel(),
        apiConfig: { baseUrl: config.apiBaseUrl },
        ensureBaiduNetdiskResource: (request: Parameters<typeof ensureBaiduNetdiskShareDownloaded>[0]) => ensureBaiduNetdiskShareDownloaded({
          ...request,
          requesterPlatform: "baidu-drama",
        }),
        config: {
          browser: {
            headless: config.headless === "true",
            slowMo: Number.parseFloat(config.operationDelaySeconds) * 1000,
          },
        },
      });
      accountRuntimes.push({ account, runtime });
    }
  } catch (error) {
    running = false;
    await Promise.allSettled(accountRuntimes.map(({ runtime }) => runtime.stop()));
    throw error;
  }

  return {
    getStatus(): BaiduDramaRuntimeStatus {
      const runtimeAccounts = accountRuntimes.map(({ account, runtime }) => {
        const accountStatus = runtime.getStatus();
        return {
          ...accountStatus,
          accountId: account.accountId,
          accountName: account.accountName,
          loginAccount: account.loginAccount,
          launched: accountStatus.running,
        };
      });
      if (runtimeAccounts.every((account) => !account.launched)) running = false;
      return {
        platform: "baidu-drama",
        running,
        createUrl: "https://duanju.baidu.com/builder/rc/edit?type=playlet&sub_type=create_playlet_type&action=new",
        loginUrl: "https://duanju.baidu.com/builder/theme/playletPlat/product",
        accounts: runtimeAccounts,
      };
    },
    async stop() {
      running = false;
      await Promise.allSettled(accountRuntimes.map(({ runtime }) => runtime.stop()));
      baiduDramaPlatformLogger("browser").info("全部账号浏览器已停止");
    },
  };
}

export function getBaiduDramaBrowserInstanceCount() {
  return runtimeController.current
    ?.getStatus()
    .accounts.filter((account) => account.launched).length ?? 0;
}

export function getBaiduDramaRunningPlatformCount() {
  return runtimeController.current?.getStatus().running ? 1 : 0;
}

export function getBaiduDramaPlatformRuntimeSummary() {
  const runtime = runtimeController.current?.getStatus();
  const runningAccounts = runtime?.accounts.filter((account) => account.launched) ?? [];
  return {
    platform: "baidu-drama" as const,
    running: Boolean(runtime?.running),
    browserInstanceCount: runningAccounts.length,
    browserInstances: runningAccounts.map((account) => ({
      id: account.accountId,
      label: account.accountName,
      loginState: account.loginState,
      activeUrl: account.activeUrl,
    })),
    logDir: storagePaths().logDir,
  };
}

export function openBaiduDramaLogDir() {
  const paths = storagePaths();
  mkdirSync(paths.logDir, { recursive: true });
  return openExistingPath(paths.logDir);
}

export function registerBaiduDramaPlatformHandlers() {
  scheduleBaiduAiCoverTemporaryFileCleanup();

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
    assertGlobalDirectoriesConfigured();
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
