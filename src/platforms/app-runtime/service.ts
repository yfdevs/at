import type { IpcRendererEvent } from "electron";
import type { PlatformId } from "@/config/navigation";

export type AppBrowserInstanceSummary = {
  id: string;
  label: string;
  loginState?: string;
  activeUrl?: string;
};

export type AppPlatformRuntimeSummary = {
  platform: PlatformId;
  running: boolean;
  browserInstanceCount: number;
  browserInstances: AppBrowserInstanceSummary[];
  logDir: string;
};

export type AppPlatformRuntimeResult = {
  appVersion: string;
  platform: AppPlatformRuntimeSummary;
};

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

function requireIpcRenderer(action: string) {
  if (!window.ipcRenderer) {
    throw new Error(`${action}仅在 Electron 应用内可用。`);
  }

  return window.ipcRenderer;
}

export function getAppPlatformRuntime(platformId: PlatformId) {
  return requireIpcRenderer("平台运行状态").invoke(
    "app:platform:runtime",
    platformId,
  ) as Promise<AppPlatformRuntimeResult>;
}

export function openAppPlatformLogs(platformId: PlatformId) {
  return requireIpcRenderer("打开日志目录").invoke(
    "app:platform:open-logs",
    platformId,
  ) as Promise<string>;
}

export function getAppUpdateStatus() {
  return requireIpcRenderer("应用更新状态").invoke(
    "app:update:status",
  ) as Promise<AppUpdateStatus>;
}

export function checkForAppUpdate() {
  return requireIpcRenderer("检查应用更新").invoke(
    "app:update:check",
  ) as Promise<AppUpdateStatus>;
}

export function downloadAppUpdate() {
  return requireIpcRenderer("下载应用更新").invoke(
    "app:update:download",
  ) as Promise<AppUpdateStatus>;
}

export function installAppUpdate() {
  return requireIpcRenderer("安装应用更新").invoke(
    "app:update:install",
  ) as Promise<AppUpdateStatus>;
}

export function onAppUpdateChanged(listener: (status: AppUpdateStatus) => void) {
  if (!window.ipcRenderer) {
    return () => undefined;
  }

  const ipcListener = (_event: IpcRendererEvent, nextStatus: AppUpdateStatus) => {
    listener(nextStatus);
  };

  window.ipcRenderer.on("app:update:changed", ipcListener);

  return () => {
    window.ipcRenderer.off("app:update:changed", ipcListener);
  };
}
