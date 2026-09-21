import { app, ipcMain } from "electron";
import Store from "electron-store";
import { registerTaskAnalyticsHandler } from "./task-analytics";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  assertGlobalDirectoriesConfigured,
  createConfiguredAiClient,
  getConfiguredAiCoverGenerationRetryAttempts,
  getConfiguredAiImageModel,
  resolveGlobalPlatformDirectories,
} from "../global-app-config";
import { createElectronPlatformLogger } from "../platform-logger";
import { registerRuntimeAssetCleanupRoot } from "../runtime-asset-cleanup";
import { ensureBaiduNetdiskShareDownloaded } from "./baidu-netdisk";
import {
  directoryDefaultPath,
  normalizePlatformRunDataDir,
  openExistingPath,
  playwrightBrowsersPath,
  resolveFromAppRoot,
  RuntimeController,
  selectDirectory,
} from "./shared";

type Account = {
  id: number;
  accountId: string;
  accountName: string;
  loginAccount?: string | null;
};

type AccountStatus = {
  platform: "taobao-drama";
  running: boolean;
  loginState: "login-required" | "verification-required" | "logged-in" | "unknown";
  activeUrl?: string;
  collectionCreateUrl: string;
  batchPublishUrl: string;
  loginUrl: string;
  userDataDir: string;
  lastTask?: {
    accountTaskId: number;
    originalTitle?: string;
    status: "running" | "succeeded" | "failed";
    errorMessage?: string;
    updatedAt: string;
  };
};

type AccountRuntime = { getStatus: () => AccountStatus; stop: () => Promise<void> };
type PlatformStatus = {
  platform: "taobao-drama";
  running: boolean;
  collectionCreateUrl: string;
  batchPublishUrl: string;
  loginUrl: string;
  accounts: Array<AccountStatus & Account & { launched: boolean }>;
};
type PlatformRuntime = { getStatus: () => PlatformStatus; stop: () => Promise<void> };

export type TaobaoDramaConfig = {
  apiBaseUrl: string;
  headless: string;
  operationDelaySeconds: string;
  taskPollIntervalSeconds: string;
  baiduNetdiskDownloadRetryAttempts: string;
  episodeUploadWaitTimeoutMinutes: string;
  closeFailedTaskPages: string;
  runDataDir: string;
  logRetentionDays: string;
};

type StoragePaths = {
  runDataDir: string;
  accountDir: string;
  userDataDir: string;
  credentialStatePath: string;
  assetDownloadDir: string;
  logDir: string;
  logFilePath: string;
};

export type TaobaoDramaServiceStatus = PlatformStatus & { pid: number | null };

const collectionCreateUrl =
  "https://creator.guanghe.taobao.com/page/unify/collect-create" +
  "?type=1&collectConfig=%5B1%2C3%5D&mode=0&source=guanghe" +
  "&from=%2Fpage%2Funify%2Fcollection";
const batchPublishUrl =
  "https://creator.guanghe.taobao.com/page/unify/creation-tool/batch-publish" +
  "?ugc_scene=short_drama_multipublish";
const loginUrl =
  "https://login.taobao.com/havanaone/login/login.htm?bizName=taobao&sub=true" +
  `&redirectURL=${encodeURIComponent(collectionCreateUrl)}`;

const defaults: TaobaoDramaConfig = {
  apiBaseUrl: "http://180.184.76.232:19090",
  headless: "false",
  operationDelaySeconds: "0",
  taskPollIntervalSeconds: "10",
  baiduNetdiskDownloadRetryAttempts: "3",
  episodeUploadWaitTimeoutMinutes: "120",
  closeFailedTaskPages: "false",
  runDataDir: "D:\\.drama-runs\\taobao-drama",
  logRetentionDays: "3",
};

const controller = new RuntimeController<PlatformRuntime>();
let store: Store<{ config: TaobaoDramaConfig }> | null = null;

function configStore() {
  store ??= new Store<{ config: TaobaoDramaConfig }>({
    name: "taobao-drama-config",
    defaults: { config: defaults },
  });
  return store;
}

function numberText(value: string | undefined, fallback: string, minimum = 0) {
  const parsed = Number(value);
  return value?.trim() && Number.isFinite(parsed) && parsed >= minimum ? value.trim() : fallback;
}

function normalizeConfig(config: Partial<TaobaoDramaConfig>): TaobaoDramaConfig {
  return {
    apiBaseUrl: config.apiBaseUrl?.trim() || defaults.apiBaseUrl,
    headless: config.headless ?? defaults.headless,
    operationDelaySeconds: numberText(config.operationDelaySeconds, defaults.operationDelaySeconds),
    taskPollIntervalSeconds: numberText(config.taskPollIntervalSeconds, defaults.taskPollIntervalSeconds, 1),
    baiduNetdiskDownloadRetryAttempts: numberText(
      config.baiduNetdiskDownloadRetryAttempts,
      defaults.baiduNetdiskDownloadRetryAttempts,
    ),
    episodeUploadWaitTimeoutMinutes: numberText(
      config.episodeUploadWaitTimeoutMinutes,
      defaults.episodeUploadWaitTimeoutMinutes,
      1,
    ),
    closeFailedTaskPages: config.closeFailedTaskPages ?? defaults.closeFailedTaskPages,
    runDataDir: config.runDataDir?.trim() || defaults.runDataDir,
    logRetentionDays: numberText(config.logRetentionDays, defaults.logRetentionDays, 1),
  };
}

function readConfig() {
  const config = normalizeConfig(configStore().get("config"));
  const directories = resolveGlobalPlatformDirectories("taobao-drama", {
    runDataDir: config.runDataDir,
    localMaterialRoot: "",
  });
  return { ...config, ...directories };
}

function runDataDir(config: Pick<TaobaoDramaConfig, "runDataDir"> = readConfig()) {
  return resolveFromAppRoot(config.runDataDir);
}

function storagePaths(
  config: Pick<TaobaoDramaConfig, "runDataDir"> = readConfig(),
  accountId = "default",
): StoragePaths {
  const encoded = encodeURIComponent(accountId.trim() || "default");
  const accountDir = path.join(runDataDir(config), "auth", "accounts", encoded);
  const logDir = path.join(runDataDir(config), "logs");
  return {
    runDataDir: runDataDir(config),
    accountDir,
    userDataDir: path.join(accountDir, "chromium-profile"),
    credentialStatePath: path.join(accountDir, "storage-state.json"),
    assetDownloadDir: path.join(runDataDir(config), "assets", encoded),
    logDir,
    logFilePath: path.join(logDir, `app-${new Date().toISOString().slice(0, 10)}.log`),
  };
}

function ensureDirectories(paths: StoragePaths) {
  [paths.runDataDir, paths.accountDir, paths.userDataDir, paths.assetDownloadDir, paths.logDir]
    .forEach((directory) => mkdirSync(directory, { recursive: true }));
}

function latestLog(paths = storagePaths()) {
  mkdirSync(paths.logDir, { recursive: true });
  return readdirSync(paths.logDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:log|jsonl)$/i.test(entry.name))
    .map((entry) => path.join(paths.logDir, entry.name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0] ?? paths.logDir;
}

function openPathOrParent(value: string) {
  return openExistingPath(existsSync(value) ? value : path.dirname(value));
}

function platformLogger(scope = "runtime") {
  const config = readConfig();
  return createElectronPlatformLogger({
    platform: "taobao-drama",
    scope,
    logDir: path.join(runDataDir(config), "logs"),
    retentionDays: Number(config.logRetentionDays) || 3,
  });
}

async function importRuntimePackage() {
  return import("@drama/taobao-drama-automation") as Promise<{
    fetchTaobaoDramaAccounts: (baseUrl: string) => Promise<Account[]>;
    startTaobaoDramaRuntime: (options: Record<string, unknown>) => Promise<AccountRuntime>;
  }>;
}

function stoppedStatus(): TaobaoDramaServiceStatus {
  return {
    platform: "taobao-drama",
    running: false,
    collectionCreateUrl,
    batchPublishUrl,
    loginUrl,
    accounts: [],
    pid: null,
  };
}

async function status(): Promise<TaobaoDramaServiceStatus> {
  const runtime = controller.current;
  if (!runtime) return stoppedStatus();
  const current = runtime.getStatus();
  if (!current.running) {
    await controller.stop();
    return stoppedStatus();
  }
  return { ...current, pid: process.pid };
}

async function startRuntime(): Promise<PlatformRuntime> {
  process.env.PLAYWRIGHT_BROWSERS_PATH = playwrightBrowsersPath();
  const config = readConfig();
  const { fetchTaobaoDramaAccounts, startTaobaoDramaRuntime } = await importRuntimePackage();
  const accounts = await fetchTaobaoDramaAccounts(config.apiBaseUrl);
  if (accounts.length === 0) throw new Error("TAOBAO_DRAMA_ENABLED_ACCOUNT_NOT_FOUND");
  platformLogger("account").info("Loaded enabled accounts", {
    count: accounts.length,
    accounts: accounts.map((account) => ({ id: account.accountId, name: account.accountName })),
  });
  const aiClient = createConfiguredAiClient();
  const runtimes: Array<{ account: Account; runtime: AccountRuntime }> = [];
  let running = true;
  try {
    for (const account of accounts) {
      const paths = storagePaths(config, account.accountId);
      ensureDirectories(paths);
      const runtime = await startTaobaoDramaRuntime({
        accountProfileName: account.accountId,
        accountId: account.accountId,
        accountName: account.accountName,
        accountDir: paths.accountDir,
        userDataDir: paths.userDataDir,
        credentialStatePath: paths.credentialStatePath,
        assetDownloadDir: paths.assetDownloadDir,
        logFilePath: paths.logFilePath,
        logRetentionDays: Number(config.logRetentionDays) || 3,
        localMaterialRoot: config.localMaterialRoot,
        baiduNetdiskDownloadRetryAttempts: Number(config.baiduNetdiskDownloadRetryAttempts) || 0,
        episodeUploadWaitTimeoutMinutes: Number(config.episodeUploadWaitTimeoutMinutes) || 120,
        taskPollIntervalMs: (Number(config.taskPollIntervalSeconds) || 10) * 1_000,
        closeFailedTaskPages: config.closeFailedTaskPages === "true",
        aiClient,
        aiImageModel: getConfiguredAiImageModel(),
        aiCoverGenerationRetryAttempts: getConfiguredAiCoverGenerationRetryAttempts(),
        ensureBaiduNetdiskResource: (request: Parameters<typeof ensureBaiduNetdiskShareDownloaded>[0]) =>
          ensureBaiduNetdiskShareDownloaded({ ...request, requesterPlatform: "taobao-drama" }),
        apiConfig: { baseUrl: config.apiBaseUrl },
        config: {
          browser: {
            headless: config.headless === "true",
            slowMo: (Number(config.operationDelaySeconds) || 0) * 1_000,
          },
        },
      });
      runtimes.push({ account, runtime });
    }
  } catch (error) {
    running = false;
    await Promise.allSettled(runtimes.map(({ runtime }) => runtime.stop()));
    throw error;
  }
  return {
    getStatus() {
      const runtimeAccounts = runtimes.map(({ account, runtime }) => {
        const current = runtime.getStatus();
        return { ...current, ...account, launched: current.running };
      });
      if (runtimeAccounts.every((account) => !account.launched)) running = false;
      return {
        platform: "taobao-drama",
        running,
        collectionCreateUrl,
        batchPublishUrl,
        loginUrl,
        accounts: runtimeAccounts,
      };
    },
    async stop() {
      running = false;
      await Promise.allSettled(runtimes.map(({ runtime }) => runtime.stop()));
    },
  };
}

export function getTaobaoDramaBrowserInstanceCount() {
  return controller.current?.getStatus().accounts.filter((account) => account.launched).length ?? 0;
}

export function getTaobaoDramaRunningPlatformCount() {
  return controller.current?.getStatus().running ? 1 : 0;
}

export function getTaobaoDramaPlatformRuntimeSummary() {
  const current = controller.current?.getStatus();
  const paths = storagePaths();
  return {
    platform: "taobao-drama" as const,
    running: Boolean(current?.running),
    browserInstanceCount: current?.accounts.filter((account) => account.launched).length ?? 0,
    browserInstances: current?.accounts.filter((account) => account.launched).map((account) => ({
      id: account.accountId,
      label: account.accountName,
      loginState: account.loginState,
      activeUrl: account.activeUrl,
    })) ?? [],
    logDir: paths.logDir,
  };
}

export function openTaobaoDramaLogDir() {
  const paths = storagePaths();
  ensureDirectories(paths);
  return openExistingPath(paths.logDir);
}

export function registerTaobaoDramaPlatformHandlers() {
  registerTaskAnalyticsHandler({
    platform: "taobao-drama",
    apiBaseUrl: () => readConfig().apiBaseUrl,
    apiPrefix: "/dramaAiRpa/taobao",
  });
  registerRuntimeAssetCleanupRoot({
    platform: "taobao-drama",
    rootPath: path.join(storagePaths().runDataDir, "assets"),
    maxDepth: 2,
    retentionMs: 3 * 60 * 60 * 1_000,
  });
  ipcMain.handle("taobao-drama:config:get", () => ({
    config: readConfig(),
    path: configStore().path,
    storagePaths: storagePaths(),
    restartRequired: false,
  }));
  ipcMain.handle("taobao-drama:config:save", (_event, value: TaobaoDramaConfig) => {
    const config = normalizeConfig(value);
    configStore().set("config", config);
    return {
      config,
      path: configStore().path,
      storagePaths: storagePaths(config),
      restartRequired: controller.running || controller.startingPromise !== null,
    };
  });
  ipcMain.handle("taobao-drama:config:select-run-data-dir", async (event, current?: string) => {
    const selected = await selectDirectory(event, {
      title: "选择淘宝短剧运行数据目录",
      defaultPath: directoryDefaultPath(current, app.getPath("documents")),
      properties: ["openDirectory", "createDirectory"],
    });
    return normalizePlatformRunDataDir(selected, "taobao-drama");
  });
  ipcMain.handle(
    "taobao-drama:config:open-storage-path",
    (_event, key: keyof StoragePaths | "configFilePath" | "latestLog") => {
      const paths = storagePaths();
      ensureDirectories(paths);
      if (key === "configFilePath") return openPathOrParent(configStore().path);
      if (key === "latestLog") return openExistingPath(latestLog(paths));
      if (key === "credentialStatePath" || key === "logFilePath") return openPathOrParent(paths[key]);
      return openExistingPath(paths[key]);
    },
  );
  ipcMain.handle("taobao-drama:service:status", () => status());
  ipcMain.handle("taobao-drama:service:start", async () => {
    assertGlobalDirectoriesConfigured();
    await controller.start(startRuntime);
    return status();
  });
  ipcMain.handle("taobao-drama:service:stop", async () => {
    await controller.stop();
    return status();
  });
}

export function stopTaobaoDramaPlatformRuntime() {
  controller.stopInBackground();
}

export function stopTaobaoDramaPlatformService() {
  return controller.stop();
}
