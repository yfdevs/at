import { app, BrowserWindow, ipcMain, Menu, nativeImage } from "electron";
import { setupTitlebar, attachTitlebarToWindow } from "custom-electron-titlebar/main";
import windowStateKeeper from "electron-window-state";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { registerAppUpdaterHandlers } from "./app-updater";
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
  getTiktokDramaCenterBrowserInstanceCount,
  getTiktokDramaCenterPlatformRuntimeSummary,
  getTiktokDramaCenterRunningPlatformCount,
  openTiktokDramaCenterLogDir,
  registerTiktokDramaCenterPlatformHandlers,
  stopTiktokDramaCenterPlatformRuntime,
} from "./platforms/tiktok-drama";
import { registerBaiduNetdiskPlatformHandlers } from "./platforms/baidu-netdisk";
import { readMemoryStatus } from "./platforms/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, "..");

export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

registerMainProcessLogging();
logMain("info", "app bootstrap", {
  version: app.getVersion(),
  packaged: app.isPackaged,
  appRoot: process.env.APP_ROOT,
  mainDist: MAIN_DIST,
  rendererDist: RENDERER_DIST,
  logDir: getMainLogDir(),
});

let win: BrowserWindow | null;

type PlatformId = "wechat-drama" | "meituan-drama" | "kuaishou-drama" | "tiktok-drama";

setupTitlebar();
ipcMain.removeAllListeners("update-window-controls");
ipcMain.on("update-window-controls", (event) => {
  event.returnValue = false;
});

function getAppIconPath() {
  return path.join(process.env.VITE_PUBLIC, "icon.png");
}

function createWindow() {
  logMain("info", "creating main window");

  const appIcon = nativeImage.createFromPath(getAppIconPath());
  const fixedWindowSize = {
    width: 480,
    height: 680,
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
    logMain("info", "main window did finish load", {
      url: win?.webContents.getURL(),
    });
  });

  win.webContents.once("dom-ready", () => {
    logMain("info", "main window dom ready", {
      url: win?.webContents.getURL(),
    });
  });

  win.on("closed", () => {
    logMain("info", "main window closed");
  });

  mainWindowState.manage(win);
  attachTitlebarToWindow(win);
  win.setMenu(null);

  if (VITE_DEV_SERVER_URL) {
    logMain("info", "loading renderer url", { url: VITE_DEV_SERVER_URL });
    void win.loadURL(VITE_DEV_SERVER_URL).catch((error) => {
      logMain("error", "main window load url failed", error);
    });
  } else {
    const indexPath = path.join(RENDERER_DIST, "index.html");
    logMain("info", "loading renderer file", { indexPath });
    void win.loadFile(indexPath).catch((error) => {
      logMain("error", "main window load file failed", error);
    });
  }
}

app.on("window-all-closed", () => {
  logMain("info", "all windows closed");

  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("before-quit", () => {
  logMain("info", "app before quit");
  stopWechatVideoPlatformRuntime();
  stopMeituanCreationPlatformRuntime();
  stopKuaishouDramaPlatformRuntime();
  stopTiktokDramaCenterPlatformRuntime();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(() => {
  try {
    logMain("info", "app ready");
    Menu.setApplicationMenu(null);
    ipcMainHandleAppRuntimeStatus();
    registerWechatVideoPlatformHandlers();
    registerMeituanCreationPlatformHandlers();
    registerKuaishouDramaPlatformHandlers();
    registerTiktokDramaCenterPlatformHandlers();
    registerBaiduNetdiskPlatformHandlers();
    registerAppUpdaterHandlers({
      getRunningPlatformCount: () => getGlobalRunningPlatformStatus().running,
    });

    if (process.platform === "darwin" && VITE_DEV_SERVER_URL) {
      app.dock?.setIcon(getAppIconPath());
    }

    createWindow();
  } catch (error) {
    logMain("error", "app ready startup failed", error);
    throw error;
  }
});

function ipcMainHandleAppRuntimeStatus() {
  ipcMain.handle("app:runtime:status", async () => {
    const runningPlatformStatus = getGlobalRunningPlatformStatus();

    return {
      pid: process.pid,
      browserInstanceCount: getGlobalBrowserInstanceCount(),
      runningPlatformCount: runningPlatformStatus.running,
      totalPlatformCount: runningPlatformStatus.total,
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
    case "meituan-drama":
      return getMeituanCreationPlatformRuntimeSummary();
    case "kuaishou-drama":
      return getKuaishouDramaPlatformRuntimeSummary();
    case "tiktok-drama":
      return getTiktokDramaCenterPlatformRuntimeSummary();
    default:
      throw new Error(`未知平台：${String(platformId)}`);
  }
}

function openPlatformLogDir(platformId: PlatformId) {
  switch (platformId) {
    case "wechat-drama":
      return openWechatVideoLogDir();
    case "meituan-drama":
      return openMeituanCreationLogDir();
    case "kuaishou-drama":
      return openKuaishouDramaLogDir();
    case "tiktok-drama":
      return openTiktokDramaCenterLogDir();
    default:
      throw new Error(`未知平台：${String(platformId)}`);
  }
}

function getGlobalBrowserInstanceCount() {
  const counters = [
    getWechatVideoBrowserInstanceCount,
    getMeituanCreationBrowserInstanceCount,
    getKuaishouDramaBrowserInstanceCount,
    getTiktokDramaCenterBrowserInstanceCount,
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
    getMeituanCreationRunningPlatformCount,
    getKuaishouDramaRunningPlatformCount,
    getTiktokDramaCenterRunningPlatformCount,
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
