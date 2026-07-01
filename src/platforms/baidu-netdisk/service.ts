export const BAIDU_NETDISK_DEFAULT_DOWNLOAD_DIR = "D:\\BaiduNetdiskDownload";

export type BaiduNetdiskCdpStatus = {
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

export type BaiduNetdiskLaunchResult = {
  status: BaiduNetdiskCdpStatus;
  executablePath: string;
  restarted: boolean;
};

export type BaiduNetdiskShareInfo = {
  link: string;
  pwd: string;
  name: string;
};

export type BaiduNetdiskShareDownloadResult = {
  share: BaiduNetdiskShareInfo;
  downloadRoot?: string;
  localPath?: string;
  completed: boolean;
  skippedExisting: boolean;
  downloadDir: string;
};

function trimShareLink(value: string) {
  return value.replace(/[),，。；;、\]]+$/g, "");
}

function sanitizeWindowsName(value: string) {
  const sanitized = value.replace(/[\\/:*?"<>|]/g, "_").trim();
  return sanitized || "百度网盘分享";
}

export function parseBaiduNetdiskShareText(text: string): BaiduNetdiskShareInfo | null {
  const link = trimShareLink(text.match(/https?:\/\/pan\.baidu\.com\/s\/[^\s"'<>]+/)?.[0] ?? "");

  if (!link) {
    return null;
  }

  let pwd: string | null | undefined;
  try {
    pwd = new URL(link).searchParams.get("pwd");
  } catch {
    pwd = null;
  }

  pwd ??= text.match(/(?:提取码|密码|pwd)[:：\s]*([a-zA-Z0-9]{4})/)?.[1];
  if (!pwd) {
    return null;
  }

  const name =
    text.match(/通过网盘分享的文件[:：]\s*([^\r\n]+)/)?.[1]?.trim() ??
    text.match(/分享的文件[:：]\s*([^\r\n]+)/)?.[1]?.trim() ??
    "百度网盘分享";

  return { link, pwd, name: sanitizeWindowsName(name) };
}

function requireIpcRenderer(feature: string) {
  if (!window.ipcRenderer) {
    throw new Error(`${feature}仅在 Electron 应用内可用。`);
  }

  return window.ipcRenderer;
}

export async function getBaiduNetdiskStatus() {
  return requireIpcRenderer("百度网盘状态").invoke(
    "baidu-netdisk:service:status",
  ) as Promise<BaiduNetdiskCdpStatus>;
}

export async function controlBaiduNetdiskCdp(restart: boolean) {
  return requireIpcRenderer("百度网盘 CDP 控制").invoke(
    restart ? "baidu-netdisk:service:restart-cdp" : "baidu-netdisk:service:start-cdp",
  ) as Promise<BaiduNetdiskLaunchResult>;
}

export async function downloadBaiduNetdiskShare(shareText: string) {
  return requireIpcRenderer("百度网盘下载").invoke("baidu-netdisk:share:download", {
    shareText,
  }) as Promise<BaiduNetdiskShareDownloadResult>;
}
