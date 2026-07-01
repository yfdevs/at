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
