import { ipcMain } from "electron";
import Store from "electron-store";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type BaiduNetdiskConfig = {
  debugPort: string;
  executablePath: string;
};

type BaiduNetdiskStore = {
  config: Partial<BaiduNetdiskConfig> & Record<string, string | undefined>;
};

type BaiduNetdiskCdpStatus = {
  platform: "baidu-netdisk";
  isWindows: boolean;
  port: number;
  appRunning: boolean;
  cdpRunning: boolean;
  ready: boolean;
  executablePath?: string;
  targetCount: number;
  checkedAt: string;
  message: string;
};

type BaiduNetdiskLaunchResult = {
  status: BaiduNetdiskCdpStatus;
  executablePath: string;
  restarted: boolean;
};

type BaiduNetdiskConfigResult = {
  config: BaiduNetdiskConfig;
  path: string;
};

type BaiduNetdiskShareInfo = {
  link: string;
  pwd: string;
  name: string;
};

type BaiduNetdiskShareDownloadResult = {
  share: BaiduNetdiskShareInfo;
  downloadRoot?: string;
  localPath?: string;
  completed: boolean;
  skippedExisting: boolean;
  downloadDir: string;
};

type BaiduNetdiskShareDownloadRequest = {
  shareText?: string;
};

const defaultBaiduNetdiskConfig: BaiduNetdiskConfig = {
  debugPort: "9337",
  executablePath: "",
};

const defaultBaiduNetdiskDownloadDir = "D:\\BaiduNetdiskDownload";

const require = createRequire(import.meta.url);
let store: Store<BaiduNetdiskStore> | null = null;

function getStore() {
  if (!store) {
    store = new Store<BaiduNetdiskStore>({
      name: "baidu-netdisk-config",
      defaults: {
        config: defaultBaiduNetdiskConfig,
      },
    });
  }

  return store;
}

function normalizeDebugPort(value: string | undefined) {
  const port = Number.parseInt(value ?? "", 10);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return defaultBaiduNetdiskConfig.debugPort;
  }

  return String(port);
}

function normalizeConfig(
  config: Partial<BaiduNetdiskConfig> & Record<string, string | undefined>,
): BaiduNetdiskConfig {
  return {
    debugPort: normalizeDebugPort(config.debugPort),
    executablePath: config.executablePath?.trim() ?? "",
  };
}

function readConfig() {
  return normalizeConfig(getStore().get("config"));
}

function writeConfig(config: BaiduNetdiskConfig) {
  getStore().set("config", config);
}

function configPath() {
  return getStore().path;
}

function cdpPort(config = readConfig()) {
  return Number.parseInt(config.debugPort, 10);
}

async function importBaiduNetdiskRuntimePackage() {
  const packageJsonPath = require.resolve("@drama/baidu-netdisk-automation/package.json");
  const entryUrl = pathToFileURL(path.join(path.dirname(packageJsonPath), "dist", "index.mjs"));
  entryUrl.searchParams.set("cacheBust", String(Date.now()));

  return import(/* @vite-ignore */ entryUrl.href) as Promise<{
    checkBaiduNetdiskCdpStatus: (options: {
      port: number;
      executablePath?: string;
    }) => Promise<BaiduNetdiskCdpStatus>;
    startBaiduNetdiskCdp: (options: {
      port: number;
      executablePath?: string;
      restart?: boolean;
    }) => Promise<BaiduNetdiskLaunchResult>;
  }>;
}

async function importBaiduNetdiskDownloadRuntimePackage() {
  const packageJsonPath = require.resolve("@drama/baidu-netdisk-automation/package.json");
  const entryUrl = pathToFileURL(
    path.join(path.dirname(packageJsonPath), "dist", "download-baidu-folder.mjs"),
  );
  entryUrl.searchParams.set("cacheBust", String(Date.now()));

  return import(/* @vite-ignore */ entryUrl.href) as Promise<{
    downloadBaiduNetdiskShare: (options: {
      shareText: string;
      port: number;
      downloadDir: string;
      strategy?: "auto" | "direct" | "save";
      waitCompleteMs?: number;
    }) => Promise<Omit<BaiduNetdiskShareDownloadResult, "downloadDir">>;
  }>;
}

async function status() {
  const config = readConfig();
  const { checkBaiduNetdiskCdpStatus } = await importBaiduNetdiskRuntimePackage();

  return checkBaiduNetdiskCdpStatus({
    port: cdpPort(config),
    executablePath: config.executablePath || undefined,
  });
}

async function startCdp(restart: boolean) {
  const config = readConfig();
  const { startBaiduNetdiskCdp } = await importBaiduNetdiskRuntimePackage();

  return startBaiduNetdiskCdp({
    port: cdpPort(config),
    executablePath: config.executablePath || undefined,
    restart,
  });
}

function normalizeShareText(request: BaiduNetdiskShareDownloadRequest | undefined) {
  const shareText = request?.shareText?.trim();

  if (!shareText) {
    throw new Error("请先粘贴包含百度网盘链接和提取码的分享文本。");
  }

  return shareText;
}

async function downloadShare(request?: BaiduNetdiskShareDownloadRequest) {
  const shareText = normalizeShareText(request);
  const config = readConfig();
  const { downloadBaiduNetdiskShare } = await importBaiduNetdiskDownloadRuntimePackage();
  const result = await downloadBaiduNetdiskShare({
    shareText,
    port: cdpPort(config),
    downloadDir: defaultBaiduNetdiskDownloadDir,
    strategy: "save",
    waitCompleteMs: 0,
  });

  return {
    ...result,
    downloadDir: defaultBaiduNetdiskDownloadDir,
  } satisfies BaiduNetdiskShareDownloadResult;
}

export function registerBaiduNetdiskPlatformHandlers() {
  ipcMain.handle("baidu-netdisk:config:get", (): BaiduNetdiskConfigResult => ({
    config: readConfig(),
    path: configPath(),
  }));

  ipcMain.handle("baidu-netdisk:config:save", (_event, config: Partial<BaiduNetdiskConfig>) => {
    const nextConfig = normalizeConfig({
      ...readConfig(),
      ...config,
    });

    writeConfig(nextConfig);

    return {
      config: nextConfig,
      path: configPath(),
    } satisfies BaiduNetdiskConfigResult;
  });

  ipcMain.handle("baidu-netdisk:service:status", () => status());
  ipcMain.handle("baidu-netdisk:service:start-cdp", () => startCdp(false));
  ipcMain.handle("baidu-netdisk:service:restart-cdp", () => startCdp(true));
  ipcMain.handle("baidu-netdisk:share:download", (_event, request) =>
    downloadShare(request as BaiduNetdiskShareDownloadRequest | undefined),
  );
}
