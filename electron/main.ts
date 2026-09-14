import { app, BrowserWindow, ipcMain, Menu, nativeImage } from "electron";
import { setupTitlebar, attachTitlebarToWindow } from "custom-electron-titlebar/main";
import windowStateKeeper from "electron-window-state";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { registerAppUpdaterHandlers } from "./app-updater";
import { registerGlobalAppConfigHandlers } from "./global-app-config";
import { getMainLogDir, logMain, openMainLogDir, registerMainProcessLogging } from "./main-logger";
import {
  getWechatVideoBrowserInstanceCount,
  getWechatVideoPlatformRuntimeSummary,
  getWechatVideoRunningPlatformCount,
  openWechatVideoLogDir,
  registerWechatVideoPlatformHandlers,
  stopWechatVideoPlatformService,
  stopWechatVideoPlatformRuntime,
} from "./platforms/wechat-drama";
import {
  getWechatMiniProgramBrowserInstanceCount,
  getWechatMiniProgramPlatformRuntimeSummary,
  getWechatMiniProgramRunningPlatformCount,
  openWechatMiniProgramLogDir,
  registerWechatMiniProgramPlatformHandlers,
  stopWechatMiniProgramPlatformService,
  stopWechatMiniProgramPlatformRuntime,
} from "./platforms/wechat-miniprogram-drama";
import {
  getMeituanCreationBrowserInstanceCount,
  getMeituanCreationPlatformRuntimeSummary,
  getMeituanCreationRunningPlatformCount,
  openMeituanCreationLogDir,
  registerMeituanCreationPlatformHandlers,
  stopMeituanCreationPlatformService,
  stopMeituanCreationPlatformRuntime,
} from "./platforms/meituan-drama";
import {
  getKuaishouDramaBrowserInstanceCount,
  getKuaishouDramaPlatformRuntimeSummary,
  getKuaishouDramaRunningPlatformCount,
  openKuaishouDramaLogDir,
  registerKuaishouDramaPlatformHandlers,
  stopKuaishouDramaPlatformService,
  stopKuaishouDramaPlatformRuntime,
} from "./platforms/kuaishou-drama";
import {
  getQqDramaBrowserInstanceCount,
  getQqDramaPlatformRuntimeSummary,
  getQqDramaRunningPlatformCount,
  openQqDramaLogDir,
  registerQqDramaPlatformHandlers,
  stopQqDramaPlatformService,
  stopQqDramaPlatformRuntime,
} from "./platforms/qq-drama";
import {
  getTencentHuolongDramaBrowserInstanceCount,
  getTencentHuolongDramaPlatformRuntimeSummary,
  getTencentHuolongDramaRunningPlatformCount,
  openTencentHuolongDramaLogDir,
  registerTencentHuolongDramaPlatformHandlers,
  stopTencentHuolongDramaPlatformService,
  stopTencentHuolongDramaPlatformRuntime,
} from "./platforms/tencent-huolong-drama";
import {
  getIqiyiDramaBrowserInstanceCount,
  getIqiyiDramaPlatformRuntimeSummary,
  getIqiyiDramaRunningPlatformCount,
  openIqiyiDramaLogDir,
  registerIqiyiDramaPlatformHandlers,
  stopIqiyiDramaPlatformService,
  stopIqiyiDramaPlatformRuntime,
} from "./platforms/iqiyi-drama";
import {
  getTiktokDramaCenterBrowserInstanceCount,
  getTiktokDramaCenterPlatformRuntimeSummary,
  getTiktokDramaCenterRunningPlatformCount,
  openTiktokDramaCenterLogDir,
  registerTiktokDramaCenterPlatformHandlers,
  stopTiktokDramaCenterPlatformService,
  stopTiktokDramaCenterPlatformRuntime,
} from "./platforms/tiktok-drama";
import {
  getPinduoduoDramaBrowserInstanceCount,
  getPinduoduoDramaPlatformRuntimeSummary,
  getPinduoduoDramaRunningPlatformCount,
  openPinduoduoDramaLogDir,
  registerPinduoduoDramaPlatformHandlers,
  stopPinduoduoDramaPlatformService,
  stopPinduoduoDramaPlatformRuntime,
} from "./platforms/pinduoduo-drama";
import {
  getBaiduDramaBrowserInstanceCount,
  getBaiduDramaPlatformRuntimeSummary,
  getBaiduDramaRunningPlatformCount,
  openBaiduDramaLogDir,
  registerBaiduDramaPlatformHandlers,
  stopBaiduDramaPlatformService,
  stopBaiduDramaPlatformRuntime,
} from "./platforms/baidu-drama";
import {
  getDouyinDramaBrowserInstanceCount,
  getDouyinDramaPlatformRuntimeSummary,
  getDouyinDramaRunningPlatformCount,
  openDouyinDramaLogDir,
  registerDouyinDramaPlatformHandlers,
  stopDouyinDramaPlatformService,
  stopDouyinDramaPlatformRuntime,
} from "./platforms/douyin-drama";
import {
  ensureBaiduNetdiskCdpReadyOnStartup,
  registerBaiduNetdiskPlatformHandlers,
} from "./platforms/baidu-netdisk";
import { readDriveStatus, readMemoryStatus } from "./platforms/shared";
import { startRuntimeAssetCleanupMonitor } from "./runtime-asset-cleanup";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, "..");

export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

registerMainProcessLogging();
logMain("info", "Application startup initiated", {
  version: app.getVersion(),
  packaged: app.isPackaged,
  appRoot: process.env.APP_ROOT,
  mainDist: MAIN_DIST,
  rendererDist: RENDERER_DIST,
  logDir: getMainLogDir(),
});

let win: BrowserWindow | null;

type PlatformId =
  | "wechat-drama"
  | "wechat-miniprogram-drama"
  | "meituan-drama"
  | "kuaishou-drama"
  | "qq-drama"
  | "tencent-huolong-drama"
  | "iqiyi-drama"
  | "baidu-drama"
  | "douyin-drama"
  | "tiktok-drama"
  | "pinduoduo-drama";

setupTitlebar();
ipcMain.removeAllListeners("update-window-controls");
ipcMain.on("update-window-controls", (event) => {
  event.returnValue = false;
});

function getAppIconPath() {
  return path.join(process.env.VITE_PUBLIC, "icon.png");
}

function createWindow() {
  logMain("info", "Creating main window");

  const appIcon = nativeImage.createFromPath(getAppIconPath());
  const fixedWindowSize = {
    width: 780,
    height: 620,
  };
  const mainWindowState = windowStateKeeper({
    defaultWidth: fixedWindowSize.width,
    defaultHeight: fixedWindowSize.height,
  });

  win = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: fixedWindowSize.width,
    height: fixedWindowSize.height,
    minWidth: fixedWindowSize.width,
    minHeight: fixedWindowSize.height,
    maxWidth: fixedWindowSize.width,
    maxHeight: fixedWindowSize.height,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "AutoDrama",
    titleBarStyle: "hidden",
    icon: appIcon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      sandbox: false,
    },
  });

  win.webContents.once("did-finish-load", () => {
    logMain("info", "Main window load completed", {
      url: win?.webContents.getURL(),
    });
  });

  win.webContents.once("dom-ready", () => {
    logMain("info", "Main window page is ready", {
      url: win?.webContents.getURL(),
    });
  });

  win.on("closed", () => {
    logMain("info", "Main window closed");
  });

  mainWindowState.manage(win);
  attachTitlebarToWindow(win);
  win.setMenu(null);

  if (VITE_DEV_SERVER_URL) {
    logMain("info", "Loading development page", { url: VITE_DEV_SERVER_URL });
    void win.loadURL(VITE_DEV_SERVER_URL).catch((error) => {
      logMain("error", "Failed to load development page", error);
    });
  } else {
    const indexPath = path.join(RENDERER_DIST, "index.html");
    logMain("info", "Loading application page", { path: indexPath });
    void win.loadFile(indexPath).catch((error) => {
      logMain("error", "Failed to load application page", error);
    });
  }
}

app.on("window-all-closed", () => {
  logMain("info", "All windows closed");

  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("before-quit", () => {
  logMain("info", "Stopping all platform services");
  stopWechatVideoPlatformRuntime();
  stopWechatMiniProgramPlatformRuntime();
  stopMeituanCreationPlatformRuntime();
  stopKuaishouDramaPlatformRuntime();
  stopQqDramaPlatformRuntime();
  stopTencentHuolongDramaPlatformRuntime();
  stopIqiyiDramaPlatformRuntime();
  stopBaiduDramaPlatformRuntime();
  stopDouyinDramaPlatformRuntime();
  stopTiktokDramaCenterPlatformRuntime();
  stopPinduoduoDramaPlatformRuntime();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(() => {
  try {
    logMain("info", "Application ready");
    Menu.setApplicationMenu(null);
    ipcMainHandleAppRuntimeStatus();
    registerGlobalAppConfigHandlers({
      getRunningPlatformCount: () => getGlobalRunningPlatformStatus().running,
    });
    registerWechatVideoPlatformHandlers();
    registerWechatMiniProgramPlatformHandlers();
    registerMeituanCreationPlatformHandlers();
    registerKuaishouDramaPlatformHandlers();
    registerQqDramaPlatformHandlers();
    registerTencentHuolongDramaPlatformHandlers();
    registerIqiyiDramaPlatformHandlers();
    registerBaiduDramaPlatformHandlers();
    registerDouyinDramaPlatformHandlers();
    registerTiktokDramaCenterPlatformHandlers();
    registerPinduoduoDramaPlatformHandlers();
    registerBaiduNetdiskPlatformHandlers();
    startRuntimeAssetCleanupMonitor();
    registerAppUpdaterHandlers({
      getRunningPlatformCount: () => getGlobalRunningPlatformStatus().running,
      stopAllPlatformServices,
    });
    ensureBaiduNetdiskCdpReadyInBackground();

    if (process.platform === "darwin" && VITE_DEV_SERVER_URL) {
      app.dock?.setIcon(getAppIconPath());
    }

    createWindow();
  } catch (error) {
    logMain("error", "Application startup failed", error);
    throw error;
  }
});

function ensureBaiduNetdiskCdpReadyInBackground() {
  void (async () => {
    try {
      logMain("info", "Checking Baidu Netdisk connection");
      const result = await ensureBaiduNetdiskCdpReadyOnStartup();
      logMain("info", "Baidu Netdisk connection check completed", {
        action: result.action,
        ready: result.status.ready,
        appRunning: result.status.appRunning,
        cdpRunning: result.status.cdpRunning,
        port: result.status.port,
        message: result.status.message,
      });
    } catch (error) {
      logMain("error", "Baidu Netdisk connection check failed", error);
    }
  })();
}

function ipcMainHandleAppRuntimeStatus() {
  ipcMain.handle("app:runtime:status", async () => {
    const runningPlatformStatus = getGlobalRunningPlatformStatus();

    return {
      pid: process.pid,
      browserInstanceCount: getGlobalBrowserInstanceCount(),
      runningPlatformCount: runningPlatformStatus.running,
      totalPlatformCount: runningPlatformStatus.total,
      disk: {
        dDrive: await readDriveStatus("D:"),
      },
      memory: await readMemoryStatus(),
    };
  });

  ipcMain.handle("app:platform:runtime", (_event, platformId: PlatformId) => ({
    appVersion: app.getVersion(),
    platform: getPlatformRuntimeSummary(platformId),
  }));

  ipcMain.handle("app:platform:open-logs", (_event, platformId: PlatformId) =>
    openPlatformLogDir(platformId),
  );

  ipcMain.handle("app:logs:open-main", () => openMainLogDir());
}

function getPlatformRuntimeSummary(platformId: PlatformId) {
  switch (platformId) {
    case "wechat-drama":
      return getWechatVideoPlatformRuntimeSummary();
    case "wechat-miniprogram-drama":
      return getWechatMiniProgramPlatformRuntimeSummary();
    case "meituan-drama":
      return getMeituanCreationPlatformRuntimeSummary();
    case "kuaishou-drama":
      return getKuaishouDramaPlatformRuntimeSummary();
    case "qq-drama":
      return getQqDramaPlatformRuntimeSummary();
    case "tencent-huolong-drama":
      return getTencentHuolongDramaPlatformRuntimeSummary();
    case "iqiyi-drama":
      return getIqiyiDramaPlatformRuntimeSummary();
    case "baidu-drama":
      return getBaiduDramaPlatformRuntimeSummary();
    case "douyin-drama":
      return getDouyinDramaPlatformRuntimeSummary();
    case "tiktok-drama":
      return getTiktokDramaCenterPlatformRuntimeSummary();
    case "pinduoduo-drama":
      return getPinduoduoDramaPlatformRuntimeSummary();
    default:
      throw new Error(`未知平台：${String(platformId)}`);
  }
}

function openPlatformLogDir(platformId: PlatformId) {
  switch (platformId) {
    case "wechat-drama":
      return openWechatVideoLogDir();
    case "wechat-miniprogram-drama":
      return openWechatMiniProgramLogDir();
    case "meituan-drama":
      return openMeituanCreationLogDir();
    case "kuaishou-drama":
      return openKuaishouDramaLogDir();
    case "qq-drama":
      return openQqDramaLogDir();
    case "tencent-huolong-drama":
      return openTencentHuolongDramaLogDir();
    case "iqiyi-drama":
      return openIqiyiDramaLogDir();
    case "baidu-drama":
      return openBaiduDramaLogDir();
    case "douyin-drama":
      return openDouyinDramaLogDir();
    case "tiktok-drama":
      return openTiktokDramaCenterLogDir();
    case "pinduoduo-drama":
      return openPinduoduoDramaLogDir();
    default:
      throw new Error(`未知平台：${String(platformId)}`);
  }
}

function getGlobalBrowserInstanceCount() {
  const counters = [
    getWechatVideoBrowserInstanceCount,
    getWechatMiniProgramBrowserInstanceCount,
    getMeituanCreationBrowserInstanceCount,
    getKuaishouDramaBrowserInstanceCount,
    getQqDramaBrowserInstanceCount,
    getTencentHuolongDramaBrowserInstanceCount,
    getIqiyiDramaBrowserInstanceCount,
    getBaiduDramaBrowserInstanceCount,
    getDouyinDramaBrowserInstanceCount,
    getTiktokDramaCenterBrowserInstanceCount,
    getPinduoduoDramaBrowserInstanceCount,
  ];

  return counters.reduce((count, readCount) => {
    try {
      return count + readCount();
    } catch {
      return count;
    }
  }, 0);
}

function getGlobalRunningPlatformStatus() {
  const counters = [
    getWechatVideoRunningPlatformCount,
    getWechatMiniProgramRunningPlatformCount,
    getMeituanCreationRunningPlatformCount,
    getKuaishouDramaRunningPlatformCount,
    getQqDramaRunningPlatformCount,
    getTencentHuolongDramaRunningPlatformCount,
    getIqiyiDramaRunningPlatformCount,
    getBaiduDramaRunningPlatformCount,
    getDouyinDramaRunningPlatformCount,
    getTiktokDramaCenterRunningPlatformCount,
    getPinduoduoDramaRunningPlatformCount,
  ];

  return {
    running: counters.reduce((count, readCount) => {
      try {
        return count + readCount();
      } catch {
        return count;
      }
    }, 0),
    total: counters.length,
  };
}

async function stopAllPlatformServices() {
  const services = [
    { label: "微信视频号", stop: stopWechatVideoPlatformService },
    { label: "微信小程序", stop: stopWechatMiniProgramPlatformService },
    { label: "美团短剧", stop: stopMeituanCreationPlatformService },
    { label: "快手短剧", stop: stopKuaishouDramaPlatformService },
    { label: "QQ 短剧", stop: stopQqDramaPlatformService },
    { label: "腾讯火龙", stop: stopTencentHuolongDramaPlatformService },
    { label: "爱奇艺短剧", stop: stopIqiyiDramaPlatformService },
    { label: "百度短剧", stop: stopBaiduDramaPlatformService },
    { label: "抖音短剧", stop: stopDouyinDramaPlatformService },
    { label: "TikTok 短剧", stop: stopTiktokDramaCenterPlatformService },
    { label: "拼多多短剧", stop: stopPinduoduoDramaPlatformService },
  ];
  const results = await Promise.allSettled(services.map(({ stop }) => stop()));
  const failures = results.flatMap((result, index) => {
    if (result.status !== "rejected") return [];
    const label = services[index]?.label ?? `平台 ${index + 1}`;
    logMain("error", `Failed to stop ${label} before update installation`, result.reason);
    return [label];
  });

  if (failures.length > 0) {
    throw new Error(`${failures.join("、")}停止失败。`);
  }
}
