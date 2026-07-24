import { app, ipcMain } from "electron";
import Store from "electron-store";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
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

type QqDramaLoginState = "login-required" | "logged-in" | "unknown";

type QqDramaAccount = {
  id: number;
  accountId: string;
  accountName: string;
  loginAccount?: string | null;
  rpaProfileKey?: string | null;
};

type QqDramaAccountRuntimeStatus = {
  platform: "qq-drama";
  running: boolean;
  loginState: QqDramaLoginState;
  activeUrl?: string;
  addUrl: string;
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
    status: "running" | "succeeded" | "failed";
    errorMessage?: string;
    updatedAt: string;
  };
};

type QqDramaAccountRuntime = {
  getStatus: () => QqDramaAccountRuntimeStatus;
  stop: () => Promise<void>;
};

type QqDramaRuntimeStatus = {
  platform: "qq-drama";
  running: boolean;
  addUrl: string;
  loginUrl: string;
  accounts: Array<QqDramaAccountRuntimeStatus & {
    accountId: string;
    accountName: string;
    loginAccount?: string | null;
    launched: boolean;
  }>;
};

type QqDramaRuntime = {
  getStatus: () => QqDramaRuntimeStatus;
  stop: () => Promise<void>;
};

export type QqDramaConfig = {
  accountProfileName: string;
  apiBaseUrl: string;
  localEpisodeVideoRoot: string;
  baiduNetdiskDownloadRetryAttempts: string;
  headless: string;
  operationDelaySeconds: string;
  taskPollIntervalSeconds: string;
  runDataDir: string;
  logRetentionDays: string;
};

type QqDramaStoragePaths = {
  runDataDir: string;
  accountDir: string;
  userDataDir: string;
  credentialStatePath: string;
  assetDownloadDir: string;
  logDir: string;
  logFilePath: string;
};

export type QqDramaServiceStatus = QqDramaRuntimeStatus & {
  pid: number | null;
};

type QqDramaConfigResult = {
  config: QqDramaConfig;
  path: string;
  storagePaths: QqDramaStoragePaths;
  restartRequired: boolean;
};

type QqDramaStore = {
  config: Partial<QqDramaConfig> & Record<string, string | undefined>;
};

const defaultQqDramaConfig: QqDramaConfig = {
  accountProfileName: "default",
  apiBaseUrl: "http://180.184.76.232:19090",
  localEpisodeVideoRoot: "",
  baiduNetdiskDownloadRetryAttempts: "3",
  headless: "false",
  operationDelaySeconds: "0",
  taskPollIntervalSeconds: "10",
  runDataDir: "D:\\.drama-runs\\qq-drama",
  logRetentionDays: "3",
};

const runtimeController = new RuntimeController<QqDramaRuntime>();
let store: Store<QqDramaStore> | null = null;

export function getQqDramaBrowserInstanceCount() {
  return (
    runtimeController.current
      ?.getStatus()
      .accounts.filter((account) => account.launched).length ?? 0
  );
}

export function getQqDramaRunningPlatformCount() {
  return runtimeController.current?.getStatus().running ? 1 : 0;
}

export function getQqDramaPlatformRuntimeSummary() {
  const runtimeStatus = runtimeController.current?.getStatus();
  const running = Boolean(runtimeStatus?.running);
  const paths = storagePaths();

  return {
    platform: "qq-drama" as const,
    running,
    browserInstanceCount:
      runtimeStatus?.accounts.filter((account) => account.launched).length ?? 0,
    browserInstances: runtimeStatus?.accounts
      .filter((account) => account.launched)
      .map((account) => ({
        id: account.accountId,
        label: account.accountName,
        loginState: account.loginState,
        activeUrl: account.activeUrl,
      })) ?? [],
    logDir: paths.logDir,
  };
}

export function openQqDramaLogDir() {
  const paths = storagePaths();
  mkdirSync(paths.logDir, { recursive: true });
  return openExistingPath(paths.logDir);
}

function getStore() {
  if (!store) {
    store = new Store<QqDramaStore>({
      name: "qq-drama-config",
      defaults: {
        config: defaultQqDramaConfig,
      },
    });
  }

  return store;
}

function normalizeNumberText(value: string | undefined, fallback: string, minimum = 0) {
  const nextValue = value?.trim();
  if (!nextValue) return fallback;

  const numericValue = Number.parseFloat(nextValue);
  if (!Number.isFinite(numericValue) || numericValue < minimum) {
    return fallback;
  }

  return nextValue;
}

function normalizeConfig(
  config: Partial<QqDramaConfig> & Record<string, string | undefined>,
): QqDramaConfig {
  return {
    accountProfileName:
      config.accountProfileName?.trim() || defaultQqDramaConfig.accountProfileName,
    apiBaseUrl: config.apiBaseUrl?.trim() || defaultQqDramaConfig.apiBaseUrl,
    localEpisodeVideoRoot: config.localEpisodeVideoRoot ?? defaultQqDramaConfig.localEpisodeVideoRoot,
    baiduNetdiskDownloadRetryAttempts: normalizeNumberText(
      config.baiduNetdiskDownloadRetryAttempts,
      defaultQqDramaConfig.baiduNetdiskDownloadRetryAttempts,
      0,
    ),
    headless: config.headless ?? defaultQqDramaConfig.headless,
    operationDelaySeconds: normalizeNumberText(
      config.operationDelaySeconds,
      defaultQqDramaConfig.operationDelaySeconds,
    ),
    taskPollIntervalSeconds: normalizeNumberText(
      config.taskPollIntervalSeconds,
      defaultQqDramaConfig.taskPollIntervalSeconds,
      1,
    ),
    runDataDir:
      !config.runDataDir || config.runDataDir === ".drama-runs" || config.runDataDir === ".drama-runs/qq-drama"
        ? defaultQqDramaConfig.runDataDir
        : config.runDataDir,
    logRetentionDays: normalizeNumberText(
      config.logRetentionDays,
      defaultQqDramaConfig.logRetentionDays,
      1,
    ),
  };
}

function readConfig(): QqDramaConfig {
  return normalizeConfig(getStore().get("config"));
}

function writeConfig(config: QqDramaConfig) {
  getStore().set("config", config);
}

function configPath() {
  return getStore().path;
}

function qqDramaRunDataDir(config = readConfig()) {
  return resolveFromAppRoot(config.runDataDir);
}

function encodedAccountProfileName(
  config = readConfig(),
  accountProfileName = config.accountProfileName,
) {
  return encodeURIComponent(accountProfileName.trim() || "default");
}

function qqDramaAccountDir(
  config = readConfig(),
  accountProfileName = config.accountProfileName,
) {
  return path.join(
    qqDramaRunDataDir(config),
    "auth",
    "accounts",
    encodedAccountProfileName(config, accountProfileName),
  );
}

function qqDramaUserDataDir(
  config = readConfig(),
  accountProfileName = config.accountProfileName,
) {
  return path.join(qqDramaAccountDir(config, accountProfileName), "chromium-profile");
}

function qqDramaCredentialStatePath(
  config = readConfig(),
  accountProfileName = config.accountProfileName,
) {
  return path.join(qqDramaAccountDir(config, accountProfileName), "storage-state.json");
}

function qqDramaAssetDownloadDir(
  config = readConfig(),
  accountProfileName = config.accountProfileName,
) {
  return path.join(
    qqDramaRunDataDir(config),
    "assets",
    encodedAccountProfileName(config, accountProfileName),
  );
}

function qqDramaLogDir(config = readConfig()) {
  return path.join(qqDramaRunDataDir(config), "logs");
}

function formatDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function qqDramaLogFile(config = readConfig()) {
  return path.join(qqDramaLogDir(config), `app-${formatDateKey()}.jsonl`);
}

function storagePaths(
  config = readConfig(),
  accountProfileName = config.accountProfileName,
): QqDramaStoragePaths {
  return {
    runDataDir: qqDramaRunDataDir(config),
    accountDir: qqDramaAccountDir(config, accountProfileName),
    userDataDir: qqDramaUserDataDir(config, accountProfileName),
    credentialStatePath: qqDramaCredentialStatePath(config, accountProfileName),
    assetDownloadDir: qqDramaAssetDownloadDir(config, accountProfileName),
    logDir: qqDramaLogDir(config),
    logFilePath: qqDramaLogFile(config),
  };
}

function ensureStorageDirectories(paths = storagePaths()) {
  mkdirSync(paths.runDataDir, { recursive: true });
  mkdirSync(paths.accountDir, { recursive: true });
  mkdirSync(paths.userDataDir, { recursive: true });
  mkdirSync(paths.assetDownloadDir, { recursive: true });
  mkdirSync(paths.logDir, { recursive: true });
}

function findLatestLogPath(paths = storagePaths()) {
  mkdirSync(paths.logDir, { recursive: true });
  const latestLogFile = readdirSync(paths.logDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^app-\d{4}-\d{2}-\d{2}\.(?:jsonl|log)$/i.test(entry.name))
    .map((entry) => path.join(paths.logDir, entry.name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0];

  return latestLogFile ?? paths.logDir;
}

function openPathOrParent(targetPath: string) {
  return openExistingPath(existsSync(targetPath) ? targetPath : path.dirname(targetPath));
}

async function importQqDramaRuntimePackage() {
  return import("@drama/qq-drama-automation") as Promise<{
    fetchQqDramaAccounts: (
      apiBaseUrl: string,
      fetcher?: typeof fetch,
    ) => Promise<QqDramaAccount[]>;
    startQqDramaRuntime: (
      options: Record<string, unknown>,
    ) => Promise<QqDramaAccountRuntime>;
  }>;
}

async function defaultStoppedStatus(): Promise<QqDramaServiceStatus> {
  return {
    platform: "qq-drama",
    running: false,
    addUrl: "https://aishortdrama.qq.com/cpplatform#/drama/add",
    loginUrl: "https://aishortdrama.qq.com/cpplatform#/login",
    accounts: [],
    pid: null,
  };
}

async function status(): Promise<QqDramaServiceStatus> {
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

async function startRuntime() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = playwrightBrowsersPath();

  const config = readConfig();
  const operationDelayMs = Math.max(0, Number.parseFloat(config.operationDelaySeconds) || 0) * 1000;
  const logRetentionDays = Math.max(1, Number.parseInt(config.logRetentionDays, 10) || 3);
  const baiduNetdiskDownloadRetryAttempts = Math.max(
    0,
    Number.parseInt(config.baiduNetdiskDownloadRetryAttempts, 10) || 0,
  );
  const taskPollIntervalMs = Math.max(1, Number.parseFloat(config.taskPollIntervalSeconds) || 10) * 1000;
  const {
    fetchQqDramaAccounts,
    startQqDramaRuntime,
  } = await importQqDramaRuntimePackage();
  const accounts = await fetchQqDramaAccounts(config.apiBaseUrl);
  if (!accounts.length) {
    throw new Error("QQ_DRAMA_ENABLED_ACCOUNT_NOT_FOUND");
  }
  console.log(
    `[qq-drama] fetched ${accounts.length} enabled account(s): ${
      accounts.map((account) => `${account.accountName}(${account.accountId})`).join(", ")
    }`,
  );

  const accountRuntimes: Array<{
    account: QqDramaAccount;
    runtime: QqDramaAccountRuntime;
  }> = [];
  let running = true;

  try {
    for (const account of accounts) {
      const paths = storagePaths(config, account.accountId);
      ensureStorageDirectories(paths);
      const runtime = await startQqDramaRuntime({
        accountProfileName: account.accountId,
        qqAccountId: account.accountId,
        qqAccountName: account.accountName,
        accountDir: paths.accountDir,
        userDataDir: paths.userDataDir,
        credentialStatePath: paths.credentialStatePath,
        assetDownloadDir: paths.assetDownloadDir,
        logFilePath: paths.logFilePath,
        logRetentionDays,
        localEpisodeVideoRoot: config.localEpisodeVideoRoot,
        baiduNetdiskDownloadRetryAttempts,
        taskPollIntervalMs,
        taskPollingEnabled: false,
        ensureBaiduNetdiskResource: ensureBaiduNetdiskShareDownloaded,
        apiConfig: {
          baseUrl: config.apiBaseUrl,
        },
        config: {
          browser: {
            headless: config.headless === "true",
            slowMo: operationDelayMs,
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
    getStatus(): QqDramaRuntimeStatus {
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
      if (runtimeAccounts.every((account) => !account.launched)) {
        running = false;
      }
      return {
        platform: "qq-drama",
        running,
        addUrl: "https://aishortdrama.qq.com/cpplatform#/drama/add",
        loginUrl: "https://aishortdrama.qq.com/cpplatform#/login",
        accounts: runtimeAccounts,
      };
    },
    async stop() {
      running = false;
      await Promise.allSettled(accountRuntimes.map(({ runtime }) => runtime.stop()));
      console.log("[qq-drama] all account browsers stopped");
    },
  };
}

export function registerQqDramaPlatformHandlers() {
  ipcMain.handle("qq-drama:config:get", () => ({
    config: readConfig(),
    path: configPath(),
    storagePaths: storagePaths(),
    restartRequired: false,
  }));

  ipcMain.handle("qq-drama:config:save", (_event, config: QqDramaConfig): QqDramaConfigResult => {
    const nextConfig = normalizeConfig(config);
    writeConfig(nextConfig);
    return {
      config: nextConfig,
      path: configPath(),
      storagePaths: storagePaths(nextConfig),
      restartRequired: runtimeController.running || runtimeController.startingPromise !== null,
    };
  });

  ipcMain.handle("qq-drama:config:select-run-data-dir", async (event, currentPath?: string) => {
    const selectedPath = await selectDirectory(event, {
      title: "选择 QQ 短剧运行数据目录",
      defaultPath: directoryDefaultPath(currentPath, app.getPath("documents")),
      properties: ["openDirectory", "createDirectory"],
    });

    return normalizePlatformRunDataDir(selectedPath, "qq-drama");
  });

  ipcMain.handle("qq-drama:config:select-local-episode-video-root", async (event, currentPath?: string) => {
    return selectDirectory(event, {
      title: "选择 QQ 短剧剧集视频根目录",
      defaultPath: directoryDefaultPath(currentPath, app.getPath("videos")),
      properties: ["openDirectory", "createDirectory"],
    });
  });

  ipcMain.handle(
    "qq-drama:config:open-storage-path",
    async (_event, key: keyof QqDramaStoragePaths | "configFilePath" | "latestLog") => {
      const paths = storagePaths();
      ensureStorageDirectories(paths);

      if (key === "configFilePath") {
        return openPathOrParent(configPath());
      }
      if (key === "latestLog") {
        return openExistingPath(findLatestLogPath(paths));
      }
      if (key === "credentialStatePath" || key === "logFilePath") {
        return openPathOrParent(paths[key]);
      }
      return openExistingPath(paths[key]);
    },
  );

  ipcMain.handle("qq-drama:service:status", () => status());

  ipcMain.handle("qq-drama:service:start", async () => {
    const runtime = runtimeController.current;
    if (runtime && !runtime.getStatus().running) {
      await runtimeController.stop();
    }

    await runtimeController.start(startRuntime);
    return status();
  });

  ipcMain.handle("qq-drama:service:stop", async () => {
    await runtimeController.stop();
    return status();
  });
}

export function stopQqDramaPlatformRuntime() {
  runtimeController.stopInBackground();
}
