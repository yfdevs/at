import { app, BrowserWindow, ipcMain } from "electron";
import { CancellationError, CancellationToken } from "builder-util-runtime";
import Store from "electron-store";
import { createRequire } from "node:module";
import type { ProgressInfo, UpdateInfo } from "electron-updater";

import { logMain } from "./main-logger";

const require = createRequire(import.meta.url);

const appUpdateSources = [
  {
    id: "accelerated",
    label: "down.mxw.xx.kg（默认）",
    description: "通过 down.mxw.xx.kg 获取 GitHub Release，国内网络通常更快。",
    url: "https://down.mxw.xx.kg/https://github.com/yfdevs/at/releases/latest/download",
  },
  {
    id: "github",
    label: "GitHub 官方源",
    description: "直接连接 GitHub Release，适合可稳定访问 GitHub 的网络。",
    url: "https://github.com/yfdevs/at/releases/latest/download",
  },
  {
    id: "github-dpik-top",
    label: "github.dpik.top",
    description: "通过 github.dpik.top 加速获取 GitHub Release。",
    url: "https://github.dpik.top/https://github.com/yfdevs/at/releases/latest/download",
  },
  {
    id: "gh-proxy-com",
    label: "gh-proxy.com",
    description: "通过 gh-proxy.com 加速获取 GitHub Release。",
    url: "https://gh-proxy.com/https://github.com/yfdevs/at/releases/latest/download",
  },
  {
    id: "github-tbap-top",
    label: "github.tbap.top",
    description: "通过 github.tbap.top 加速获取 GitHub Release。",
    url: "https://github.tbap.top/https://github.com/yfdevs/at/releases/latest/download",
  },
  {
    id: "memory-echoes",
    label: "github-proxy.memory-echoes.cn",
    description: "通过 github-proxy.memory-echoes.cn 加速获取 GitHub Release。",
    url: "https://github-proxy.memory-echoes.cn/https://github.com/yfdevs/at/releases/latest/download",
  },
  {
    id: "gh-dpik-top",
    label: "gh.dpik.top",
    description: "通过 gh.dpik.top 加速获取 GitHub Release。",
    url: "https://gh.dpik.top/https://github.com/yfdevs/at/releases/latest/download",
  },
  {
    id: "geekertao",
    label: "ghfile.geekertao.top",
    description: "通过 ghfile.geekertao.top 加速获取 GitHub Release。",
    url: "https://ghfile.geekertao.top/https://github.com/yfdevs/at/releases/latest/download",
  },
  {
    id: "ghproxy-net",
    label: "ghproxy.net",
    description: "通过 ghproxy.net 加速获取 GitHub Release。",
    url: "https://ghproxy.net/https://github.com/yfdevs/at/releases/latest/download",
  },
] as const;

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

export type AppUpdateSourceId = (typeof appUpdateSources)[number]["id"];

export type AppUpdateSource = {
  id: AppUpdateSourceId;
  label: string;
  description: string;
  url: string;
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
  source: AppUpdateSource;
  sources: AppUpdateSource[];
  updatedAt: string;
};

type AppUpdateStore = {
  sourceId: AppUpdateSourceId;
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
let store: Store<AppUpdateStore> | null = null;
let downloadCancellationToken: CancellationToken | null = null;

function getStore() {
  if (!store) {
    store = new Store<AppUpdateStore>({
      name: "app-update-config",
      defaults: {
        sourceId: "accelerated",
      },
    });
  }

  return store;
}

function getSelectedUpdateSource(): AppUpdateSource {
  const sourceId = getStore().get("sourceId");
  return appUpdateSources.find((source) => source.id === sourceId) ?? appUpdateSources[0];
}

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
  ipcMain.handle("app:update:download:cancel", () => cancelAppUpdateDownload());
  ipcMain.handle("app:update:install", () => installAppUpdate());
  ipcMain.handle("app:update:source:set", (_event, sourceId: AppUpdateSourceId) =>
    setAppUpdateSource(sourceId),
  );
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

    applySelectedUpdateSource(autoUpdater);
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
  const cancellationToken = new CancellationToken();
  downloadCancellationToken = cancellationToken;

  try {
    const autoUpdater = getAutoUpdater();

    if (!autoUpdater) {
      throw new Error(readDisabledReason() ?? "更新模块不可用。");
    }

    await autoUpdater.downloadUpdate(cancellationToken);
  } catch (error) {
    if (error instanceof CancellationError || cancellationToken.cancelled) {
      return getAppUpdateStatus();
    }

    setStatus({
      state: "error",
      error: readableError(error),
    });
    throw error;
  } finally {
    if (downloadCancellationToken === cancellationToken) {
      downloadCancellationToken = null;
    }
    cancellationToken.dispose();
  }

  return getAppUpdateStatus();
}

function cancelAppUpdateDownload() {
  if (status?.state !== "downloading" || !downloadCancellationToken) {
    throw new Error("当前没有正在下载的应用更新。");
  }

  downloadCancellationToken.cancel();
  return setStatus({
    state: "available",
    progress: undefined,
    error: undefined,
  });
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
  applySelectedUpdateSource(autoUpdater);

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
      error: undefined,
    });
  });

  autoUpdater.on("error", (error) => {
    setStatus({
      state: "error",
      error: readableError(error),
    });
  });
}

function setAppUpdateSource(sourceId: AppUpdateSourceId) {
  const source = appUpdateSources.find((candidate) => candidate.id === sourceId);

  if (!source) {
    throw new Error("未知的应用更新源。");
  }

  if (
    ["checking", "downloading", "installing", "downloaded"].includes(status?.state ?? "")
  ) {
    throw new Error("当前更新任务进行中，暂时不能切换更新源。");
  }

  getStore().set("sourceId", source.id);

  const autoUpdater = getAutoUpdater();
  if (autoUpdater) {
    applySelectedUpdateSource(autoUpdater);
  }

  latestUpdateInfo = null;
  return setStatus({
    state: "idle",
    latestVersion: undefined,
    releaseName: undefined,
    releaseDate: undefined,
    releaseNotes: undefined,
    progress: undefined,
    error: undefined,
  });
}

function applySelectedUpdateSource(
  autoUpdater: typeof import("electron-updater").autoUpdater,
) {
  const source = getSelectedUpdateSource();
  autoUpdater.setFeedURL({
    provider: "generic",
    url: source.url,
    channel: "latest",
  });
  logMain("info", "app update source configured", {
    sourceId: source.id,
    url: source.url,
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
  const source = getSelectedUpdateSource();

  return {
    ...nextStatus,
    supported: process.platform === "win32",
    enabled: !disabledReason,
    currentVersion: app.getVersion(),
    disabledReason,
    source,
    sources: [...appUpdateSources],
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
    source: getSelectedUpdateSource(),
    sources: [...appUpdateSources],
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
