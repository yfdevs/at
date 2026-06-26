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

type KuaishouDramaRuntimeStatus = {
  platform: "kuaishou-drama";
  running: boolean;
  loginState: "login-required" | "logged-in" | "unknown";
  activeUrl?: string;
  userDataDir: string;
};

type KuaishouDramaRuntime = {
  getStatus: () => KuaishouDramaRuntimeStatus;
  stop: () => Promise<void>;
};

export type KuaishouDramaConfig = {
  headless: string;
  operationDelaySeconds: string;
  runDataDir: string;
};

export type KuaishouDramaServiceStatus = KuaishouDramaRuntimeStatus & {
  pid: number | null;
};

type KuaishouDramaConfigResult = {
  config: KuaishouDramaConfig;
  path: string;
  restartRequired: boolean;
};

type KuaishouDramaStore = {
  config: Partial<KuaishouDramaConfig> & Record<string, string | undefined>;
};

const defaultKuaishouDramaConfig: KuaishouDramaConfig = {
  headless: "false",
  operationDelaySeconds: "0.02",
  runDataDir: ".drama-runs/kuaishou-drama",
};

const runtimeController = new RuntimeController<KuaishouDramaRuntime>();
let store: Store<KuaishouDramaStore> | null = null;

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
    headless: config.headless ?? defaultKuaishouDramaConfig.headless,
    operationDelaySeconds:
      config.operationDelaySeconds ?? defaultKuaishouDramaConfig.operationDelaySeconds,
    runDataDir:
      !config.runDataDir || config.runDataDir === ".drama-runs"
        ? defaultKuaishouDramaConfig.runDataDir
        : config.runDataDir,
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

function kuaishouDramaUserDataDir() {
  return path.join(kuaishouDramaRunDataDir(), "auth", "chromium-profile");
}

function kuaishouDramaCredentialStatePath() {
  return path.join(kuaishouDramaRunDataDir(), "auth", "storage-state.json");
}

async function defaultStoppedStatus(): Promise<KuaishouDramaServiceStatus> {
  return {
    platform: "kuaishou-drama",
    running: false,
    loginState: "unknown",
    userDataDir: kuaishouDramaUserDataDir(),
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
  const operationDelayMs = Math.max(0, Number.parseFloat(config.operationDelaySeconds) || 0) * 1000;
  const runtimePackage = "@drama/kuaishou-drama-automation";
  const { startKuaishouDramaRuntime } = await import(/* @vite-ignore */ runtimePackage);
  return startKuaishouDramaRuntime({
    userDataDir: kuaishouDramaUserDataDir(),
    credentialStatePath: kuaishouDramaCredentialStatePath(),
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

export function registerKuaishouDramaPlatformHandlers() {
  ipcMain.handle("kuaishou-drama:config:get", () => ({
    config: readConfig(),
    path: configPath(),
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
