import { app, BrowserWindow, ipcMain, Menu, nativeImage } from "electron";
import { setupTitlebar, attachTitlebarToWindow } from "custom-electron-titlebar/main";
import windowStateKeeper from "electron-window-state";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  getWechatVideoBrowserInstanceCount,
  getWechatVideoRunningPlatformCount,
  registerWechatVideoPlatformHandlers,
  stopWechatVideoPlatformRuntime,
} from "./platforms/wechat-video";
import {
  getMeituanCreationBrowserInstanceCount,
  getMeituanCreationRunningPlatformCount,
  registerMeituanCreationPlatformHandlers,
  stopMeituanCreationPlatformRuntime,
} from "./platforms/meituan-creation";
import {
  getKuaishouDramaBrowserInstanceCount,
  getKuaishouDramaRunningPlatformCount,
  registerKuaishouDramaPlatformHandlers,
  stopKuaishouDramaPlatformRuntime,
} from "./platforms/kuaishou-drama";
import {
  getTiktokDramaCenterBrowserInstanceCount,
  getTiktokDramaCenterRunningPlatformCount,
  registerTiktokDramaCenterPlatformHandlers,
  stopTiktokDramaCenterPlatformRuntime,
} from "./platforms/tiktok-drama-center";
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

let win: BrowserWindow | null;

setupTitlebar();
ipcMain.removeAllListeners("update-window-controls");
ipcMain.on("update-window-controls", (event) => {
  event.returnValue = false;
});

function getAppIconPath() {
  return path.join(process.env.VITE_PUBLIC, "icon.png");
}

function createWindow() {
  const appIcon = nativeImage.createFromPath(getAppIconPath());
  const fixedWindowSize = {
    width: 720,
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
  mainWindowState.manage(win);
  attachTitlebarToWindow(win);
  win.setMenu(null);

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("before-quit", () => {
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
  Menu.setApplicationMenu(null);
  ipcMainHandleAppRuntimeStatus();
  registerWechatVideoPlatformHandlers();
  registerMeituanCreationPlatformHandlers();
  registerKuaishouDramaPlatformHandlers();
  registerTiktokDramaCenterPlatformHandlers();
  registerBaiduNetdiskPlatformHandlers();

  if (process.platform === "darwin" && VITE_DEV_SERVER_URL) {
    app.dock?.setIcon(getAppIconPath());
  }

  createWindow();
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
