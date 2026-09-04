import { app, BrowserWindow, ipcMain, Menu, nativeImage } from "electron";
import { setupTitlebar, attachTitlebarToWindow } from "custom-electron-titlebar/main";
import windowStateKeeper from "electron-window-state";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { registerAppUpdaterHandlers } from "./app-updater";
import { registerGlobalAppConfigHandlers } from "./global-app-config";
import { getLocalAiRuntimeStatus, stopLocalAiRuntime } from "./local-ai-runtime";
import {
  getMainLogDir,
  logMain,
  openMainLogDir,
  registerMainProcessLogging,
} from "./main-logger";
import {
  getWechatVideoBrowserInstanceCount,
  getWechatVideoPlatformRuntimeSummary,
  getWechatVideoRunningPlatformCount,
  openWechatVideoLogDir,
  registerWechatVideoPlatformHandlers,
  stopWechatVideoPlatformRuntime,
} from "./platforms/wechat-drama";
import {
  getWechatMiniProgramBrowserInstanceCount,
  getWechatMiniProgramPlatformRuntimeSummary,
  getWechatMiniProgramRunningPlatformCount,
  openWechatMiniProgramLogDir,
  registerWechatMiniProgramPlatformHandlers,
  stopWechatMiniProgramPlatformRuntime,
} from "./platforms/wechat-miniprogram-drama";
import {
  getMeituanCreationBrowserInstanceCount,
  getMeituanCreationPlatformRuntimeSummary,
  getMeituanCreationRunningPlatformCount,
  openMeituanCreationLogDir,
  registerMeituanCreationPlatformHandlers,
  stopMeituanCreationPlatformRuntime,
} from "./platforms/meituan-drama";
import {
  getKuaishouDramaBrowserInstanceCount,
  getKuaishouDramaPlatformRuntimeSummary,
  getKuaishouDramaRunningPlatformCount,
  openKuaishouDramaLogDir,
  registerKuaishouDramaPlatformHandlers,
  stopKuaishouDramaPlatformRuntime,
} from "./platforms/kuaishou-drama";
import {
  getQqDramaBrowserInstanceCount,
  getQqDramaPlatformRuntimeSummary,
  getQqDramaRunningPlatformCount,
  openQqDramaLogDir,
  registerQqDramaPlatformHandlers,
  stopQqDramaPlatformRuntime,
} from "./platforms/qq-drama";
import {
  getIqiyiDramaBrowserInstanceCount,
  getIqiyiDramaPlatformRuntimeSummary,
  getIqiyiDramaRunningPlatformCount,
  openIqiyiDramaLogDir,
  registerIqiyiDramaPlatformHandlers,
  stopIqiyiDramaPlatformRuntime,
} from "./platforms/iqiyi-drama";
import {
  getTiktokDramaCenterBrowserInstanceCount,
  getTiktokDramaCenterPlatformRuntimeSummary,
  getTiktokDramaCenterRunningPlatformCount,
  openTiktokDramaCenterLogDir,
  registerTiktokDramaCenterPlatformHandlers,
  stopTiktokDramaCenterPlatformRuntime,
} from "./platforms/tiktok-drama";
import {
  getPinduoduoDramaBrowserInstanceCount,
  getPinduoduoDramaPlatformRuntimeSummary,
  getPinduoduoDramaRunningPlatformCount,
  openPinduoduoDramaLogDir,
  registerPinduoduoDramaPlatformHandlers,
  stopPinduoduoDramaPlatformRuntime,
} from "./platforms/pinduoduo-drama";
import {
  getBaiduDramaBrowserInstanceCount,
  getBaiduDramaPlatformRuntimeSummary,
  getBaiduDramaRunningPlatformCount,
  openBaiduDramaLogDir,
  registerBaiduDramaPlatformHandlers,
  stopBaiduDramaPlatformRuntime,
} from "./platforms/baidu-drama";
import {
  getDouyinDramaBrowserInstanceCount,
  getDouyinDramaPlatformRuntimeSummary,
  getDouyinDramaRunningPlatformCount,
  openDouyinDramaLogDir,
  registerDouyinDramaPlatformHandlers,
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
logMain("info", "应用开始启动", {
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
  logMain("info", "正在创建主窗口");

  const appIcon = nativeImage.createFromPath(getAppIconPath());
  const fixedWindowSize = {
    width: 680,
    height: 720,
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
    logMain("info", "主窗口加载完成", {
      url: win?.webContents.getURL(),
    });
  });

  win.webContents.once("dom-ready", () => {
    logMain("info", "主窗口页面已就绪", {
      url: win?.webContents.getURL(),
    });
  });

  win.on("closed", () => {
    logMain("info", "主窗口已关闭");
  });

  mainWindowState.manage(win);
  attachTitlebarToWindow(win);
  win.setMenu(null);

  if (VITE_DEV_SERVER_URL) {
    logMain("info", "正在加载开发页面", { url: VITE_DEV_SERVER_URL });
    void win.loadURL(VITE_DEV_SERVER_URL).catch((error) => {
      logMain("error", "开发页面加载失败", error);
    });
  } else {
    const indexPath = path.join(RENDERER_DIST, "index.html");
    logMain("info", "正在加载应用页面", { path: indexPath });
    void win.loadFile(indexPath).catch((error) => {
      logMain("error", "应用页面加载失败", error);
    });
  }
}

app.on("window-all-closed", () => {
  logMain("info", "全部窗口已关闭");

  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("before-quit", () => {
  logMain("info", "正在停止各平台服务");
  stopWechatVideoPlatformRuntime();
  stopWechatMiniProgramPlatformRuntime();
  stopMeituanCreationPlatformRuntime();
  stopKuaishouDramaPlatformRuntime();
  stopQqDramaPlatformRuntime();
  stopIqiyiDramaPlatformRuntime();
  stopBaiduDramaPlatformRuntime();
  stopDouyinDramaPlatformRuntime();
  stopTiktokDramaCenterPlatformRuntime();
  stopPinduoduoDramaPlatformRuntime();
  void stopLocalAiRuntime();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(() => {
  try {
    logMain("info", "应用已就绪");
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
    registerIqiyiDramaPlatformHandlers();
    registerBaiduDramaPlatformHandlers();
    registerDouyinDramaPlatformHandlers();
    registerTiktokDramaCenterPlatformHandlers();
    registerPinduoduoDramaPlatformHandlers();
    registerBaiduNetdiskPlatformHandlers();
    startRuntimeAssetCleanupMonitor();
    registerAppUpdaterHandlers({
      getRunningPlatformCount: () => getGlobalRunningPlatformStatus().running,
    });
    ensureBaiduNetdiskCdpReadyInBackground();

    if (process.platform === "darwin" && VITE_DEV_SERVER_URL) {
      app.dock?.setIcon(getAppIconPath());
    }

    createWindow();
  } catch (error) {
    logMain("error", "应用启动失败", error);
    throw error;
  }
});

function ensureBaiduNetdiskCdpReadyInBackground() {
  void (async () => {
    try {
      logMain("info", "正在检查百度网盘连接");
      const result = await ensureBaiduNetdiskCdpReadyOnStartup();
      logMain("info", "百度网盘连接检查完成", {
        action: result.action,
        ready: result.status.ready,
        appRunning: result.status.appRunning,
        cdpRunning: result.status.cdpRunning,
        port: result.status.port,
        message: result.status.message,
      });
    } catch (error) {
      logMain("error", "百度网盘连接检查失败", error);
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
      localAi: getLocalAiRuntimeStatus(),
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
