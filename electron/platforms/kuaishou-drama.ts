import { app, ipcMain } from "electron";
import Store from "electron-store";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  directoryDefaultPath,
  normalizePlatformRunDataDir,
  openExistingPath,
  playwrightBrowsersPath,
  resolveFromAppRoot,
  RuntimeController,
  selectDirectory,
} from "./shared";

type KuaishouDramaRuntimeStatus = {
  platform: "kuaishou-drama";
  running: boolean;
  loginState: "login-required" | "logged-in" | "unknown";
  activeUrl?: string;
  userDataDir: string;
  accountProfileName?: string;
  accountDir?: string;
  credentialStatePath?: string;
  assetDownloadDir?: string;
  logFilePath?: string;
};

type KuaishouDramaRuntime = {
  getStatus: () => KuaishouDramaRuntimeStatus;
  stop: () => Promise<void>;
};

export type KuaishouDramaConfig = {
  accountProfileName: string;
  headless: string;
  operationDelaySeconds: string;
  runDataDir: string;
  logRetentionDays: string;
  mockTaskEnabled: string;
};

export type KuaishouDramaServiceStatus = KuaishouDramaRuntimeStatus & {
  pid: number | null;
};

type KuaishouDramaConfigResult = {
  config: KuaishouDramaConfig;
  path: string;
  storagePaths: KuaishouDramaStoragePaths;
  restartRequired: boolean;
};

type KuaishouDramaStoragePaths = {
  runDataDir: string;
  accountDir: string;
  userDataDir: string;
  credentialStatePath: string;
  assetDownloadDir: string;
  logDir: string;
  logFilePath: string;
};

type KuaishouDramaStore = {
  config: Partial<KuaishouDramaConfig> & Record<string, string | undefined>;
};

const defaultKuaishouDramaConfig: KuaishouDramaConfig = {
  accountProfileName: "default",
  headless: "false",
  operationDelaySeconds: "0",
  runDataDir: ".drama-runs/kuaishou-drama",
  logRetentionDays: "3",
  mockTaskEnabled: "true",
};

const runtimeController = new RuntimeController<KuaishouDramaRuntime>();
const require = createRequire(import.meta.url);
let store: Store<KuaishouDramaStore> | null = null;

export function getKuaishouDramaBrowserInstanceCount() {
  return runtimeController.current?.getStatus().running ? 1 : 0;
}

export function getKuaishouDramaRunningPlatformCount() {
  return runtimeController.current?.getStatus().running ? 1 : 0;
}

export function getKuaishouDramaPlatformRuntimeSummary() {
  const runtimeStatus = runtimeController.current?.getStatus();
  const running = Boolean(runtimeStatus?.running);
  const paths = storagePaths();

  return {
    platform: "kuaishou-drama" as const,
    running,
    browserInstanceCount: running ? 1 : 0,
    browserInstances: running
      ? [{
          id: runtimeStatus?.accountProfileName ?? "default",
          label: runtimeStatus?.accountProfileName ?? "快手短剧",
          loginState: runtimeStatus?.loginState ?? "unknown",
          activeUrl: runtimeStatus?.activeUrl,
        }]
      : [],
    logDir: paths.logDir,
  };
}

export function openKuaishouDramaLogDir() {
  const paths = storagePaths();
  mkdirSync(paths.logDir, { recursive: true });
  return openExistingPath(paths.logDir);
}

function normalizeOperationDelaySeconds(value: string | undefined) {
  const nextValue = value?.trim();
  if (!nextValue || nextValue === "0.02") {
    return defaultKuaishouDramaConfig.operationDelaySeconds;
  }

  const numericValue = Number.parseFloat(nextValue);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return defaultKuaishouDramaConfig.operationDelaySeconds;
  }

  return nextValue;
}

function getStore() {
  if (!store) {
    store = new Store<KuaishouDramaStore>({
      name: "kuaishou-drama-config",
      defaults: {
        config: defaultKuaishouDramaConfig,
      },
    });
  }

  return store;
}

function normalizeConfig(
  config: Partial<KuaishouDramaConfig> & Record<string, string | undefined>,
): KuaishouDramaConfig {
  return {
    accountProfileName:
      config.accountProfileName?.trim() || defaultKuaishouDramaConfig.accountProfileName,
    headless: config.headless ?? defaultKuaishouDramaConfig.headless,
    operationDelaySeconds: normalizeOperationDelaySeconds(config.operationDelaySeconds),
    runDataDir:
      !config.runDataDir || config.runDataDir === ".drama-runs"
        ? defaultKuaishouDramaConfig.runDataDir
        : config.runDataDir,
    logRetentionDays: config.logRetentionDays ?? defaultKuaishouDramaConfig.logRetentionDays,
    mockTaskEnabled: config.mockTaskEnabled ?? defaultKuaishouDramaConfig.mockTaskEnabled,
  };
}

function readConfig(): KuaishouDramaConfig {
  return normalizeConfig(getStore().get("config"));
}

function writeConfig(config: KuaishouDramaConfig) {
  getStore().set("config", config);
}

function configPath() {
  return getStore().path;
}

function kuaishouDramaRunDataDir(config = readConfig()) {
  return resolveFromAppRoot(config.runDataDir);
}

function encodedAccountProfileName(config = readConfig()) {
  return encodeURIComponent(config.accountProfileName.trim() || "default");
}

function kuaishouDramaAccountDir(config = readConfig()) {
  return path.join(
    kuaishouDramaRunDataDir(config),
    "auth",
    "accounts",
    encodedAccountProfileName(config),
  );
}

function kuaishouDramaUserDataDir(config = readConfig()) {
  return path.join(kuaishouDramaAccountDir(config), "chromium-profile");
}

function kuaishouDramaCredentialStatePath(config = readConfig()) {
  return path.join(kuaishouDramaAccountDir(config), "storage-state.json");
}

function kuaishouDramaAssetDownloadDir(config = readConfig()) {
  return path.join(kuaishouDramaRunDataDir(config), "assets");
}

function kuaishouDramaLogDir(config = readConfig()) {
  return path.join(kuaishouDramaRunDataDir(config), "logs");
}

function formatDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function kuaishouDramaLogFile(config = readConfig()) {
  return path.join(kuaishouDramaLogDir(config), `app-${formatDateKey()}.jsonl`);
}

function storagePaths(config = readConfig()): KuaishouDramaStoragePaths {
  return {
    runDataDir: kuaishouDramaRunDataDir(config),
    accountDir: kuaishouDramaAccountDir(config),
    userDataDir: kuaishouDramaUserDataDir(config),
    credentialStatePath: kuaishouDramaCredentialStatePath(config),
    assetDownloadDir: kuaishouDramaAssetDownloadDir(config),
    logDir: kuaishouDramaLogDir(config),
    logFilePath: kuaishouDramaLogFile(config),
  };
}

function ensureStorageDirectories(paths = storagePaths()) {
  mkdirSync(paths.runDataDir, { recursive: true });
  mkdirSync(paths.accountDir, { recursive: true });
  mkdirSync(paths.userDataDir, { recursive: true });
  mkdirSync(paths.assetDownloadDir, { recursive: true });
  mkdirSync(paths.logDir, { recursive: true });
}

async function importKuaishouDramaRuntimePackage() {
  const packageJsonPath = require.resolve("@drama/kuaishou-drama-automation/package.json");
  const entryUrl = pathToFileURL(path.join(path.dirname(packageJsonPath), "dist", "index.mjs"));
  entryUrl.searchParams.set("cacheBust", String(Date.now()));

  return import(/* @vite-ignore */ entryUrl.href) as Promise<{
    createMockKuaishouDramaTaskInput: () => unknown;
    startKuaishouDramaRuntime: (
      options: Record<string, unknown>,
    ) => Promise<KuaishouDramaRuntime>;
  }>;
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

async function defaultStoppedStatus(): Promise<KuaishouDramaServiceStatus> {
  const config = readConfig();
  const paths = storagePaths(config);
  return {
    platform: "kuaishou-drama",
    running: false,
    loginState: "unknown",
    userDataDir: paths.userDataDir,
    accountProfileName: config.accountProfileName,
    accountDir: paths.accountDir,
    credentialStatePath: paths.credentialStatePath,
    assetDownloadDir: paths.assetDownloadDir,
    logFilePath: paths.logFilePath,
    pid: null,
  };
}

async function status(): Promise<KuaishouDramaServiceStatus> {
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
  const paths = storagePaths(config);
  ensureStorageDirectories(paths);
  const operationDelayMs = Math.max(0, Number.parseFloat(config.operationDelaySeconds) || 0) * 1000;
  const logRetentionDays = Math.max(1, Number.parseInt(config.logRetentionDays, 10) || 3);
  const {
    createMockKuaishouDramaTaskInput,
    startKuaishouDramaRuntime,
  } = await importKuaishouDramaRuntimePackage();
  const task = config.mockTaskEnabled === "true"
    ? createMockKuaishouDramaTaskInput()
    : undefined;
  return startKuaishouDramaRuntime({
    accountProfileName: config.accountProfileName,
    accountDir: paths.accountDir,
    userDataDir: paths.userDataDir,
    credentialStatePath: paths.credentialStatePath,
    assetDownloadDir: paths.assetDownloadDir,
    logFilePath: paths.logFilePath,
    logRetentionDays,
    onLog: (message: string) => {
      console.log(message);
    },
    config: {
      browser: {
        headless: config.headless === "true",
        slowMo: operationDelayMs,
      },
      task,
    },
  });
}

export function registerKuaishouDramaPlatformHandlers() {
  ipcMain.handle("kuaishou-drama:config:get", () => ({
    config: readConfig(),
    path: configPath(),
    storagePaths: storagePaths(),
    restartRequired: false,
  }));

  ipcMain.handle(
    "kuaishou-drama:config:save",
    (_event, config: KuaishouDramaConfig): KuaishouDramaConfigResult => {
      const nextConfig = normalizeConfig(config);
      writeConfig(nextConfig);
      return {
        config: nextConfig,
        path: configPath(),
        storagePaths: storagePaths(nextConfig),
        restartRequired: runtimeController.running || runtimeController.startingPromise !== null,
      };
    },
  );

  ipcMain.handle("kuaishou-drama:config:select-run-data-dir", async (event, currentPath?: string) => {
    const selectedPath = await selectDirectory(event, {
      title: "选择快手短剧运行数据目录",
      defaultPath: directoryDefaultPath(currentPath, app.getPath("documents")),
      properties: ["openDirectory", "createDirectory"],
    });

    return normalizePlatformRunDataDir(selectedPath, "kuaishou-drama");
  });

  ipcMain.handle(
    "kuaishou-drama:config:open-storage-path",
    async (_event, key: keyof KuaishouDramaStoragePaths | "configFilePath" | "latestLog") => {
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

  ipcMain.handle("kuaishou-drama:service:status", () => status());

  ipcMain.handle("kuaishou-drama:service:start", async () => {
    const runtime = runtimeController.current;
    if (runtime && !runtime.getStatus().running) {
      await runtimeController.stop();
    }

    await runtimeController.start(startRuntime);
    return status();
  });

  ipcMain.handle("kuaishou-drama:service:stop", async () => {
    await runtimeController.stop();
    return status();
  });
}

export function stopKuaishouDramaPlatformRuntime() {
  runtimeController.stopInBackground();
}
