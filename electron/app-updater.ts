import { app, BrowserWindow, ipcMain } from "electron";
import { createRequire } from "node:module";
import type { ProgressInfo, UpdateInfo } from "electron-updater";

import { logMain } from "./main-logger";

const require = createRequire(import.meta.url);

export type AppUpdateState =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

export type AppUpdateProgress = {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
};

export type AppUpdateStatus = {
  state: AppUpdateState;
  supported: boolean;
  enabled: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseName?: string;
  releaseDate?: string;
  releaseNotes?: string;
  progress?: AppUpdateProgress;
  error?: string;
  disabledReason?: string;
  updatedAt: string;
};

type RegisterAppUpdaterHandlersOptions = {
  getRunningPlatformCount?: () => number;
};

let configured = false;
let registered = false;
let latestUpdateInfo: UpdateInfo | null = null;
let status: AppUpdateStatus | null = null;
let getRunningPlatformCount: () => number = () => 0;
let autoUpdaterLoadError: string | null = null;
let autoUpdaterInstance:
  | typeof import("electron-updater").autoUpdater
  | null
  | undefined;

function getAutoUpdater() {
  if (autoUpdaterInstance !== undefined) {
    return autoUpdaterInstance;
  }

  try {
    const { autoUpdater } = require("electron-updater") as typeof import("electron-updater");
    autoUpdaterInstance = autoUpdater;
    autoUpdaterLoadError = null;
  } catch (error) {
    autoUpdaterInstance = null;
    autoUpdaterLoadError = readableError(error);
    logMain("error", "auto updater module load failed", error);
  }

  return autoUpdaterInstance;
}

export function registerAppUpdaterHandlers(options: RegisterAppUpdaterHandlersOptions = {}) {
  if (registered) {
    return;
  }

  registered = true;
  getRunningPlatformCount = options.getRunningPlatformCount ?? getRunningPlatformCount;
  configureAutoUpdater();

  ipcMain.handle("app:update:status", () => getAppUpdateStatus());
  ipcMain.handle("app:update:check", () => checkForAppUpdate());
  ipcMain.handle("app:update:download", () => downloadAppUpdate());
  ipcMain.handle("app:update:install", () => installAppUpdate());
}

export function getAppUpdateStatus() {
  status = normalizeStatus(status ?? createStatus("idle"));
  return status;
}

async function checkForAppUpdate() {
  const disabledReason = readDisabledReason();

  if (disabledReason) {
    return setStatus({
      state: "idle",
      progress: undefined,
      error: undefined,
      disabledReason,
    });
  }

  latestUpdateInfo = null;
  setStatus({
    state: "checking",
    latestVersion: undefined,
    releaseName: undefined,
    releaseDate: undefined,
    releaseNotes: undefined,
    progress: undefined,
    error: undefined,
  });

  try {
    const autoUpdater = getAutoUpdater();

    if (!autoUpdater) {
      setStatus({ state: "idle", disabledReason: readDisabledReason() });
      return getAppUpdateStatus();
    }

    await autoUpdater.checkForUpdates();
  } catch (error) {
    setStatus({
      state: "error",
      progress: undefined,
      error: readableError(error),
    });
  }

  return getAppUpdateStatus();
}

async function downloadAppUpdate() {
  const disabledReason = readDisabledReason();

  if (disabledReason) {
    throw new Error(disabledReason);
  }

  if (!latestUpdateInfo) {
    const message = "当前没有可下载的新版本，请先检查更新。";
    setStatus({ state: "error", error: message });
    throw new Error(message);
  }

  setStatus({ state: "downloading", progress: undefined, error: undefined });

  try {
    const autoUpdater = getAutoUpdater();

    if (!autoUpdater) {
      throw new Error(readDisabledReason() ?? "更新模块不可用。");
    }

    await autoUpdater.downloadUpdate();
  } catch (error) {
    setStatus({
      state: "error",
      error: readableError(error),
    });
    throw error;
  }

  return getAppUpdateStatus();
}

function installAppUpdate() {
  const disabledReason = readDisabledReason();

  if (disabledReason) {
    throw new Error(disabledReason);
  }

  if (status?.state !== "downloaded") {
    const message = "更新还没有下载完成，暂时不能安装。";
    setStatus({ error: message });
    throw new Error(message);
  }

  const runningPlatformCount = getRunningPlatformCount();
  if (runningPlatformCount > 0) {
    const message = `请先停止正在运行的 ${runningPlatformCount} 个平台服务，再重启安装更新。`;
    setStatus({ state: "downloaded", error: message });
    throw new Error(message);
  }

  setStatus({ state: "installing", error: undefined });
  const autoUpdater = getAutoUpdater();

  if (!autoUpdater) {
    throw new Error(readDisabledReason() ?? "更新模块不可用。");
  }

  autoUpdater.quitAndInstall(false, true);

  return getAppUpdateStatus();
}

function configureAutoUpdater() {
  if (configured) {
    return;
  }

  configured = true;
  const autoUpdater = getAutoUpdater();

  if (!autoUpdater) {
    setStatus({
      state: "idle",
      progress: undefined,
      error: undefined,
      disabledReason: readDisabledReason(),
    });
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.fullChangelog = true;

  autoUpdater.on("checking-for-update", () => {
    setStatus({ state: "checking", progress: undefined, error: undefined });
  });

  autoUpdater.on("update-available", (info) => {
    latestUpdateInfo = info;
    setStatus({
      ...statusFromUpdateInfo(info),
      state: "available",
      progress: undefined,
      error: undefined,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    latestUpdateInfo = null;
    setStatus({
      ...statusFromUpdateInfo(info),
      state: "not-available",
      progress: undefined,
      error: undefined,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    setStatus({
      state: "downloading",
      progress: statusFromProgress(progress),
      error: undefined,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    latestUpdateInfo = info;
    setStatus({
      ...statusFromUpdateInfo(info),
      state: "downloaded",
      progress: status?.progress,
      error: undefined,
    });
  });

  autoUpdater.on("update-cancelled", (info) => {
    latestUpdateInfo = info;
    setStatus({
      ...statusFromUpdateInfo(info),
      state: "available",
      progress: undefined,
      error: "更新下载已取消。",
    });
  });

  autoUpdater.on("error", (error) => {
    setStatus({
      state: "error",
      error: readableError(error),
    });
  });
}

function setStatus(nextStatus: Partial<AppUpdateStatus>) {
  status = normalizeStatus({
    ...(status ?? createStatus("idle")),
    ...nextStatus,
    updatedAt: new Date().toISOString(),
  });
  broadcastAppUpdateStatus(status);

  return status;
}

function normalizeStatus(nextStatus: AppUpdateStatus) {
  const disabledReason = readDisabledReason();

  return {
    ...nextStatus,
    supported: process.platform === "win32",
    enabled: !disabledReason,
    currentVersion: app.getVersion(),
    disabledReason,
    updatedAt: nextStatus.updatedAt || new Date().toISOString(),
  };
}

function createStatus(state: AppUpdateState): AppUpdateStatus {
  return normalizeStatus({
    state,
    supported: process.platform === "win32",
    enabled: !readDisabledReason(),
    currentVersion: app.getVersion(),
    disabledReason: readDisabledReason(),
    updatedAt: new Date().toISOString(),
  });
}

function statusFromUpdateInfo(info: UpdateInfo): Partial<AppUpdateStatus> {
  return {
    latestVersion: info.version,
    releaseName: info.releaseName ?? undefined,
    releaseDate: info.releaseDate,
    releaseNotes: normalizeReleaseNotes(info.releaseNotes),
  };
}

function statusFromProgress(progress: ProgressInfo): AppUpdateProgress {
  return {
    percent: Math.round(progress.percent * 10) / 10,
    bytesPerSecond: progress.bytesPerSecond,
    transferred: progress.transferred,
    total: progress.total,
  };
}

function normalizeReleaseNotes(releaseNotes: UpdateInfo["releaseNotes"]) {
  if (typeof releaseNotes === "string") {
    return releaseNotes.trim() || undefined;
  }

  if (Array.isArray(releaseNotes)) {
    const notes = releaseNotes
      .map((note) => [note.version, note.note].filter(Boolean).join("\n"))
      .filter(Boolean)
      .join("\n\n");

    return notes.trim() || undefined;
  }

  return undefined;
}

function readDisabledReason() {
  if (process.platform !== "win32") {
    return "当前更新功能只启用 Windows 安装包。";
  }

  if (!app.isPackaged) {
    return "开发模式下不会连接 GitHub Releases 更新源。";
  }

  if (autoUpdaterLoadError) {
    return `更新模块加载失败：${autoUpdaterLoadError}`;
  }

  return undefined;
}

function readableError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function broadcastAppUpdateStatus(nextStatus: AppUpdateStatus) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("app:update:changed", nextStatus);
    }
  }
}
