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

type MeituanCreationRuntimeStatus = {
  platform: "meituan-drama";
  loginUrl: string;
  publishVideoUrl: string;
  running: boolean;
  accounts: Array<{
    accountId: string;
    accountName: string;
    loginAccount?: string | null;
    launched: boolean;
    loginState: "login-required" | "logged-in" | "unknown";
    activeUrl?: string;
    userDataDir: string;
  }>;
};

type MeituanCreationRuntime = {
  getStatus: () => MeituanCreationRuntimeStatus;
  stop: () => Promise<void>;
};

export type MeituanCreationConfig = {
  apiBaseUrl: string;
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

const defaultMeituanCreationConfig: MeituanCreationConfig = {
  apiBaseUrl: "http://180.184.76.232:19090",
  headless: "false",
  operationDelaySeconds: "0.02",
  localEpisodeVideoRoot: "",
  runDataDir: ".drama-runs/meituan-drama",
};

const runtimeController = new RuntimeController<MeituanCreationRuntime>();
let store: Store<MeituanCreationStore> | null = null;

export function getMeituanCreationBrowserInstanceCount() {
  return (
    runtimeController.current
      ?.getStatus()
      .accounts.filter((account) => account.launched).length ?? 0
  );
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
    apiBaseUrl: config.apiBaseUrl?.trim() || defaultMeituanCreationConfig.apiBaseUrl,
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
  return {
    platform: "meituan-drama",
    loginUrl: "https://czz.meituan.com/new/login",
    publishVideoUrl: "https://czz.meituan.com/new/publishVideo",
    running: false,
    accounts: [],
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

function meituanCreationAuthRoot() {
  return path.join(meituanCreationRunDataDir(), "auth");
}

function meituanCreationAssetDownloadRoot() {
  return path.join(meituanCreationRunDataDir(), "remote-upload-assets");
}

async function startRuntime() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = playwrightBrowsersPath();

  const config = readConfig();
  const operationDelayMs = Math.max(0, Number.parseFloat(config.operationDelaySeconds) || 0) * 1000;
  const {
    fetchMeituanCreationAccounts,
    startMeituanCreationRuntime,
  } = await import("@drama/meituan-drama-automation");
  const accounts = await fetchMeituanCreationAccounts(config.apiBaseUrl);
  console.log(
    `[meituan-drama] fetched ${accounts.length} enabled account(s): ${
      accounts.map((account) => `${account.accountName}(${account.accountId})`).join(", ") || "-"
    }`,
  );
  return startMeituanCreationRuntime({
    accounts,
    authRoot: meituanCreationAuthRoot(),
    assetDownloadRoot: meituanCreationAssetDownloadRoot(),
    onLog: (message: string) => {
      console.log(message);
    },
    config: {
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
