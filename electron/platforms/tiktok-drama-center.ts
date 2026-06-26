import { app, ipcMain } from "electron";
import Store from "electron-store";
import path from "node:path";
import {
  directoryDefaultPath,
  normalizePlatformRunDataDir,
  playwrightBrowsersPath,
  resolveFromAppRoot,
  RuntimeController,
  selectDirectory,
} from "./shared";

type TiktokDramaCenterRuntimeStatus = {
  platform: "tiktok-drama-center";
  running: boolean;
  loginState: "login-required" | "logged-in" | "unknown";
  activeUrl?: string;
  userDataDir: string;
};

type TiktokDramaCenterRuntime = {
  getStatus: () => TiktokDramaCenterRuntimeStatus;
  stop: () => Promise<void>;
};

export type TiktokDramaCenterConfig = {
  headless: string;
  operationDelaySeconds: string;
  runDataDir: string;
};

export type TiktokDramaCenterServiceStatus = TiktokDramaCenterRuntimeStatus & {
  pid: number | null;
};

type TiktokDramaCenterConfigResult = {
  config: TiktokDramaCenterConfig;
  path: string;
  restartRequired: boolean;
};

type TiktokDramaCenterStore = {
  config: Partial<TiktokDramaCenterConfig> & Record<string, string | undefined>;
};

const defaultTiktokDramaCenterConfig: TiktokDramaCenterConfig = {
  headless: "false",
  operationDelaySeconds: "0.02",
  runDataDir: ".drama-runs/tiktok-drama-center",
};

const runtimeController = new RuntimeController<TiktokDramaCenterRuntime>();
let store: Store<TiktokDramaCenterStore> | null = null;

function getStore() {
  if (!store) {
    store = new Store<TiktokDramaCenterStore>({
      name: "tiktok-drama-center-config",
      defaults: {
        config: defaultTiktokDramaCenterConfig,
      },
    });
  }

  return store;
}

function normalizeConfig(
  config: Partial<TiktokDramaCenterConfig> & Record<string, string | undefined>,
): TiktokDramaCenterConfig {
  return {
    headless: config.headless ?? defaultTiktokDramaCenterConfig.headless,
    operationDelaySeconds:
      config.operationDelaySeconds ?? defaultTiktokDramaCenterConfig.operationDelaySeconds,
    runDataDir:
      !config.runDataDir || config.runDataDir === ".drama-runs"
        ? defaultTiktokDramaCenterConfig.runDataDir
        : config.runDataDir,
  };
}

function readConfig(): TiktokDramaCenterConfig {
  return normalizeConfig(getStore().get("config"));
}

function writeConfig(config: TiktokDramaCenterConfig) {
  getStore().set("config", config);
}

function configPath() {
  return getStore().path;
}

function tiktokDramaCenterRunDataDir(config = readConfig()) {
  return resolveFromAppRoot(config.runDataDir);
}

function tiktokDramaCenterUserDataDir() {
  return path.join(tiktokDramaCenterRunDataDir(), "auth", "chromium-profile");
}

function tiktokDramaCenterCredentialStatePath() {
  return path.join(tiktokDramaCenterRunDataDir(), "auth", "storage-state.json");
}

async function defaultStoppedStatus(): Promise<TiktokDramaCenterServiceStatus> {
  return {
    platform: "tiktok-drama-center",
    running: false,
    loginState: "unknown",
    userDataDir: tiktokDramaCenterUserDataDir(),
    pid: null,
  };
}

async function status(): Promise<TiktokDramaCenterServiceStatus> {
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
  const runtimePackage = "@drama/tiktok-drama-center-automation";
  const { startTiktokDramaCenterRuntime } = await import(/* @vite-ignore */ runtimePackage);
  return startTiktokDramaCenterRuntime({
    userDataDir: tiktokDramaCenterUserDataDir(),
    credentialStatePath: tiktokDramaCenterCredentialStatePath(),
    onLog: (message: string) => {
      console.log(message);
    },
    config: {
      browser: {
        headless: config.headless === "true",
        slowMo: operationDelayMs,
      },
    },
  });
}

export function registerTiktokDramaCenterPlatformHandlers() {
  ipcMain.handle("tiktok-drama-center:config:get", () => ({
    config: readConfig(),
    path: configPath(),
    restartRequired: false,
  }));

  ipcMain.handle(
    "tiktok-drama-center:config:save",
    (_event, config: TiktokDramaCenterConfig): TiktokDramaCenterConfigResult => {
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
    "tiktok-drama-center:config:select-run-data-dir",
    async (event, currentPath?: string) => {
      const selectedPath = await selectDirectory(event, {
        title: "选择 TikTok Drama Center 运行数据目录",
        defaultPath: directoryDefaultPath(currentPath, app.getPath("documents")),
        properties: ["openDirectory", "createDirectory"],
      });

      return normalizePlatformRunDataDir(selectedPath, "tiktok-drama-center");
    },
  );

  ipcMain.handle("tiktok-drama-center:service:status", () => status());

  ipcMain.handle("tiktok-drama-center:service:start", async () => {
    const runtime = runtimeController.current;
    if (runtime && !runtime.getStatus().running) {
      await runtimeController.stop();
    }

    await runtimeController.start(startRuntime);
    return status();
  });

  ipcMain.handle("tiktok-drama-center:service:stop", async () => {
    await runtimeController.stop();
    return status();
  });
}

export function stopTiktokDramaCenterPlatformRuntime() {
  runtimeController.stopInBackground();
}
