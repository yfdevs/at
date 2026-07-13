import { app, ipcMain, screen } from "electron";
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

type PinduoduoDramaRuntimeStatus = {
  platform: "pinduoduo-drama";
  running: boolean;
  loginState: "login-required" | "logged-in" | "unknown";
  activeUrl?: string;
  manageUrl: string;
  loginExpiredUrl: string;
  userDataDir: string;
  accountProfileName?: string;
  accountDir?: string;
  credentialStatePath?: string;
  logFilePath?: string;
};

type PinduoduoDramaRuntime = {
  getStatus: () => PinduoduoDramaRuntimeStatus;
  stop: () => Promise<void>;
};

export type PinduoduoDramaConfig = {
  accountProfileName: string;
  headless: string;
  operationDelaySeconds: string;
  runDataDir: string;
  logRetentionDays: string;
  browserWindowWidth: string;
};

export type PinduoduoDramaServiceStatus = PinduoduoDramaRuntimeStatus & {
  pid: number | null;
};

type PinduoduoDramaConfigResult = {
  config: PinduoduoDramaConfig;
  path: string;
  storagePaths: PinduoduoDramaStoragePaths;
  restartRequired: boolean;
};

type PinduoduoDramaStoragePaths = {
  runDataDir: string;
  accountDir: string;
  userDataDir: string;
  credentialStatePath: string;
  logDir: string;
  logFilePath: string;
};

type PinduoduoDramaStore = {
  config: Partial<PinduoduoDramaConfig> & Record<string, string | undefined>;
};

const defaultPinduoduoDramaConfig: PinduoduoDramaConfig = {
  accountProfileName: "default",
  headless: "false",
  operationDelaySeconds: "0",
  runDataDir: ".drama-runs/pinduoduo-drama",
  logRetentionDays: "3",
  browserWindowWidth: "0",
};

const runtimeController = new RuntimeController<PinduoduoDramaRuntime>();
let store: Store<PinduoduoDramaStore> | null = null;

export function getPinduoduoDramaBrowserInstanceCount() {
  return runtimeController.current?.getStatus().running ? 1 : 0;
}

export function getPinduoduoDramaRunningPlatformCount() {
  return runtimeController.current?.getStatus().running ? 1 : 0;
}

export function getPinduoduoDramaPlatformRuntimeSummary() {
  const runtimeStatus = runtimeController.current?.getStatus();
  const running = Boolean(runtimeStatus?.running);
  const paths = storagePaths();

  return {
    platform: "pinduoduo-drama" as const,
    running,
    browserInstanceCount: running ? 1 : 0,
    browserInstances: running
      ? [{
          id: runtimeStatus?.accountProfileName ?? "default",
          label: runtimeStatus?.accountProfileName ?? "拼多多短剧",
          loginState: runtimeStatus?.loginState ?? "unknown",
          activeUrl: runtimeStatus?.activeUrl,
        }]
      : [],
    logDir: paths.logDir,
  };
}

export function openPinduoduoDramaLogDir() {
  const paths = storagePaths();
  mkdirSync(paths.logDir, { recursive: true });
  return openExistingPath(paths.logDir);
}

function getStore() {
  if (!store) {
    store = new Store<PinduoduoDramaStore>({
      name: "pinduoduo-drama-config",
      defaults: {
        config: defaultPinduoduoDramaConfig,
      },
    });
  }

  return store;
}

function normalizeOperationDelaySeconds(value: string | undefined) {
  const nextValue = value?.trim();
  if (!nextValue) {
    return defaultPinduoduoDramaConfig.operationDelaySeconds;
  }

  const numericValue = Number.parseFloat(nextValue);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return defaultPinduoduoDramaConfig.operationDelaySeconds;
  }

  return nextValue;
}

function normalizePositiveInteger(value: string | undefined, fallback: string, min: number) {
  const nextValue = value?.trim();
  if (!nextValue) {
    return fallback;
  }

  const numericValue = Number.parseInt(nextValue, 10);
  if (!Number.isFinite(numericValue) || numericValue < min) {
    if (numericValue === 0) {
      return "0";
    }
    return fallback;
  }

  return String(numericValue);
}

function normalizeConfig(
  config: Partial<PinduoduoDramaConfig> & Record<string, string | undefined>,
): PinduoduoDramaConfig {
  return {
    accountProfileName:
      config.accountProfileName?.trim() || defaultPinduoduoDramaConfig.accountProfileName,
    headless: config.headless ?? defaultPinduoduoDramaConfig.headless,
    operationDelaySeconds: normalizeOperationDelaySeconds(config.operationDelaySeconds),
    runDataDir:
      !config.runDataDir || config.runDataDir === ".drama-runs"
        ? defaultPinduoduoDramaConfig.runDataDir
        : config.runDataDir,
    logRetentionDays: config.logRetentionDays ?? defaultPinduoduoDramaConfig.logRetentionDays,
    browserWindowWidth: normalizePositiveInteger(
      config.browserWindowWidth,
      defaultPinduoduoDramaConfig.browserWindowWidth,
      800,
    ),
  };
}

function readConfig(): PinduoduoDramaConfig {
  return normalizeConfig(getStore().get("config"));
}

function writeConfig(config: PinduoduoDramaConfig) {
  getStore().set("config", config);
}

function configPath() {
  return getStore().path;
}

function pinduoduoDramaRunDataDir(config = readConfig()) {
  return resolveFromAppRoot(config.runDataDir);
}

function encodedAccountProfileName(config = readConfig()) {
  return encodeURIComponent(config.accountProfileName.trim() || "default");
}

function pinduoduoDramaAccountDir(config = readConfig()) {
  return path.join(
    pinduoduoDramaRunDataDir(config),
    "auth",
    "accounts",
    encodedAccountProfileName(config),
  );
}

function pinduoduoDramaUserDataDir(config = readConfig()) {
  return path.join(pinduoduoDramaAccountDir(config), "chromium-profile");
}

function pinduoduoDramaCredentialStatePath(config = readConfig()) {
  return path.join(pinduoduoDramaAccountDir(config), "storage-state.json");
}

function pinduoduoDramaLogDir(config = readConfig()) {
  return path.join(pinduoduoDramaRunDataDir(config), "logs");
}

function formatDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function pinduoduoDramaLogFile(config = readConfig()) {
  return path.join(pinduoduoDramaLogDir(config), `app-${formatDateKey()}.jsonl`);
}

function storagePaths(config = readConfig()): PinduoduoDramaStoragePaths {
  return {
    runDataDir: pinduoduoDramaRunDataDir(config),
    accountDir: pinduoduoDramaAccountDir(config),
    userDataDir: pinduoduoDramaUserDataDir(config),
    credentialStatePath: pinduoduoDramaCredentialStatePath(config),
    logDir: pinduoduoDramaLogDir(config),
    logFilePath: pinduoduoDramaLogFile(config),
  };
}

function ensureStorageDirectories(paths = storagePaths()) {
  mkdirSync(paths.runDataDir, { recursive: true });
  mkdirSync(paths.accountDir, { recursive: true });
  mkdirSync(paths.userDataDir, { recursive: true });
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

async function defaultStoppedStatus(): Promise<PinduoduoDramaServiceStatus> {
  const config = readConfig();
  const paths = storagePaths(config);
  return {
    platform: "pinduoduo-drama",
    running: false,
    loginState: "unknown",
    manageUrl: "https://mcn.pinduoduo.com/home/shortplayManage",
    loginExpiredUrl: "https://mcn.pinduoduo.com/register",
    userDataDir: paths.userDataDir,
    accountProfileName: config.accountProfileName,
    accountDir: paths.accountDir,
    credentialStatePath: paths.credentialStatePath,
    logFilePath: paths.logFilePath,
    pid: null,
  };
}

async function status(): Promise<PinduoduoDramaServiceStatus> {
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
  const workAreaSize = screen.getPrimaryDisplay().workAreaSize;
  const browserWindowWidth = Number.parseInt(config.browserWindowWidth, 10) || workAreaSize.width;
  const browserWindowHeight = workAreaSize.height;
  const { startPinduoduoDramaRuntime } = await import("@drama/pinduoduo-drama-automation");

  return startPinduoduoDramaRuntime({
    accountProfileName: config.accountProfileName,
    accountDir: paths.accountDir,
    userDataDir: paths.userDataDir,
    credentialStatePath: paths.credentialStatePath,
    logFilePath: paths.logFilePath,
    logRetentionDays,
    onLog: (message: string) => {
      console.log(message);
    },
    config: {
      browser: {
        headless: config.headless === "true",
        slowMo: operationDelayMs,
        windowWidth: browserWindowWidth,
        windowHeight: browserWindowHeight,
      },
    },
  });
}

export function registerPinduoduoDramaPlatformHandlers() {
  ipcMain.handle("pinduoduo-drama:config:get", () => ({
    config: readConfig(),
    path: configPath(),
    storagePaths: storagePaths(),
    restartRequired: false,
  }));

  ipcMain.handle(
    "pinduoduo-drama:config:save",
    (_event, config: PinduoduoDramaConfig): PinduoduoDramaConfigResult => {
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

  ipcMain.handle(
    "pinduoduo-drama:config:select-run-data-dir",
    async (event, currentPath?: string) => {
      const selectedPath = await selectDirectory(event, {
        title: "选择拼多多短剧运行数据目录",
        defaultPath: directoryDefaultPath(currentPath, app.getPath("documents")),
        properties: ["openDirectory", "createDirectory"],
      });

      return normalizePlatformRunDataDir(selectedPath, "pinduoduo-drama");
    },
  );

  ipcMain.handle(
    "pinduoduo-drama:config:open-storage-path",
    async (_event, key: keyof PinduoduoDramaStoragePaths | "configFilePath" | "latestLog") => {
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

  ipcMain.handle("pinduoduo-drama:service:status", () => status());

  ipcMain.handle("pinduoduo-drama:service:start", async () => {
    const runtime = runtimeController.current;
    if (runtime && !runtime.getStatus().running) {
      await runtimeController.stop();
    }

    await runtimeController.start(startRuntime);
    return status();
  });

  ipcMain.handle("pinduoduo-drama:service:stop", async () => {
    await runtimeController.stop();
    return status();
  });
}

export function stopPinduoduoDramaPlatformRuntime() {
  runtimeController.stopInBackground();
}
