import { BrowserWindow, ipcMain } from "electron";
import Store from "electron-store";
import { ensureBaiduNetdiskEpisodeVideos } from "@drama/drama-video-assets/baidu-netdisk";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  BaiduNetdiskDownloadRecordsRepository,
  type BaiduNetdiskDownloadRecord,
  type BaiduNetdiskDownloadState,
} from "../storage/baidu-netdisk";

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

type BaiduNetdiskRemoteEpisodeFile = {
  index: number;
  name: string;
  path: string;
  size?: number;
};

type BaiduNetdiskRemoteVideoListing = {
  rootPath: string;
  files: BaiduNetdiskRemoteEpisodeFile[];
  allVideoFiles: Array<{
    name: string;
    path: string;
    size?: number;
  }>;
  scannedDirs?: Array<{
    path: string;
    errno?: number;
    count: number;
    hasMore?: boolean;
    entries: Array<{
      name: string;
      path: string;
      isDir: boolean;
      size?: number;
    }>;
  }>;
  duplicateIndexes: number[];
  missingIndexes?: number[];
};

type BaiduNetdiskShareDownloadResult = {
  share: BaiduNetdiskShareInfo;
  downloadRoot?: string;
  localPath?: string;
  remoteVideos?: BaiduNetdiskRemoteVideoListing;
  completed: boolean;
  skippedExisting: boolean;
  downloadDir: string;
};

type BaiduNetdiskShareDownloadRequest = {
  shareText?: string;
};

export type { BaiduNetdiskDownloadRecord, BaiduNetdiskDownloadState };

export type BaiduNetdiskEnsureDownloadedRequest = {
  shareText: string;
  resourceName: string;
  localEpisodeVideoRoot: string;
  episodeCount: number;
};

export type BaiduNetdiskDownloadRecordResult = {
  records: BaiduNetdiskDownloadRecord[];
  path: string;
};

type PlatformId =
  | "wechat-drama"
  | "meituan-drama"
  | "kuaishou-drama"
  | "qq-drama"
  | "tiktok-drama"
  | "pinduoduo-drama";

type RegisterBaiduNetdiskPlatformHandlersOptions = {
  openWindow?: (platformId: PlatformId) => void;
};

const defaultBaiduNetdiskConfig: BaiduNetdiskConfig = {
  debugPort: "9337",
  executablePath: "",
};

const defaultBaiduNetdiskDownloadDir = "D:\\BaiduNetdiskDownload";

let store: Store<BaiduNetdiskStore> | null = null;
let downloadRecordsRepository: BaiduNetdiskDownloadRecordsRepository | null = null;
const activeDownloadPromises = new Map<string, Promise<BaiduNetdiskDownloadRecord>>();

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

function getDownloadRecordsRepository() {
  if (!downloadRecordsRepository) {
    downloadRecordsRepository = new BaiduNetdiskDownloadRecordsRepository();
  }

  return downloadRecordsRepository;
}

function readDownloadRecords() {
  return getDownloadRecordsRepository().list();
}

function upsertDownloadRecord(record: BaiduNetdiskDownloadRecord): BaiduNetdiskDownloadRecord {
  const nextRecord = getDownloadRecordsRepository().upsert(record);
  broadcastDownloadRecordsChanged();
  return nextRecord;
}

function createRecordId(shareKey: string, resourceName: string) {
  return createHash("sha1")
    .update(`${shareKey}\n${resourceName.trim()}`)
    .digest("hex")
    .slice(0, 16);
}

function trimShareLink(value: string) {
  return value.replace(/[),，。；;、\]]+$/g, "");
}

function sanitizeWindowsName(value: string) {
  const sanitized = value.replace(/[\\/:*?"<>|]/g, "_").trim();
  return sanitized || "百度网盘分享";
}

function shareKeyFromText(shareText: string) {
  const link = trimShareLink(
    shareText.match(/https?:\/\/pan\.baidu\.com\/s\/[^\s"'<>]+/)?.[0] ?? "",
  );

  if (!link) {
    throw new Error("分享文本中没有找到百度网盘链接。");
  }

  try {
    const url = new URL(link);
    const pwd =
      url.searchParams.get("pwd") ??
      shareText.match(/(?:提取码|密码|pwd)[:：\s]*([a-zA-Z0-9]{4})/)?.[1];
    if (!pwd) {
      throw new Error("分享文本中没有找到提取码。");
    }

    return [url.origin.toLowerCase(), url.pathname.replace(/\/+$/, ""), pwd.toLowerCase()]
      .join("|");
  } catch (error) {
    if (error instanceof Error && error.message.includes("提取码")) {
      throw error;
    }
    throw new Error("分享文本中的百度网盘链接格式不正确。");
  }
}

function normalizeEnsureDownloadRequest(
  request: BaiduNetdiskEnsureDownloadedRequest,
): BaiduNetdiskEnsureDownloadedRequest {
  const shareText = request.shareText.trim();
  const resourceName = sanitizeWindowsName(request.resourceName);
  const localEpisodeVideoRoot = request.localEpisodeVideoRoot.trim();
  const episodeCount = Number(request.episodeCount);

  if (!shareText) {
    throw new Error("百度网盘分享链接不能为空。");
  }
  if (!resourceName) {
    throw new Error("百度网盘资源名称不能为空。");
  }
  if (!localEpisodeVideoRoot) {
    throw new Error("微信剧集视频根目录不能为空。");
  }
  if (!Number.isInteger(episodeCount) || episodeCount <= 0) {
    throw new Error("微信剧集集数必须是正整数。");
  }

  return {
    shareText,
    resourceName,
    localEpisodeVideoRoot,
    episodeCount,
  };
}

function playletDir(root: string, resourceName: string) {
  return path.join(root, resourceName);
}

function cdpPort(config = readConfig()) {
  return Number.parseInt(config.debugPort, 10);
}

async function importBaiduNetdiskRuntimePackage() {
  return import("@drama/baidu-netdisk-automation") as Promise<{
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
  return import("@drama/baidu-netdisk-automation/download-baidu-folder") as Promise<{
    downloadBaiduNetdiskShare: (options: {
      shareText: string;
      resourceName?: string;
      expectedEpisodeCount?: number;
      port: number;
      downloadDir: string;
    }) => Promise<Omit<BaiduNetdiskShareDownloadResult, "downloadDir">>;
    getBaiduNetdiskDownloadTaskStatus: (options: { port: number; targetName: string }) => Promise<{
      found: boolean;
      name?: string;
      localPath?: string;
      status?: string;
      size?: number;
      finishSize?: number;
      rate?: string;
      completed: boolean;
      tasks: string[];
    }>;
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

export async function ensureBaiduNetdiskCdpReadyOnStartup() {
  const currentStatus = await status();

  if (currentStatus.ready) {
    return {
      action: "none" as const,
      status: currentStatus,
    };
  }

  if (!currentStatus.isWindows) {
    return {
      action: "unsupported" as const,
      status: currentStatus,
    };
  }

  const launchResult = await startCdp(currentStatus.appRunning);

  return {
    action: currentStatus.appRunning ? ("restart" as const) : ("start" as const),
    status: launchResult.status,
    launchResult,
  };
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
  const shareKey = shareKeyFromText(shareText);
  const recordId = createRecordId(shareKey, shareKey);
  const now = new Date().toISOString();
  const record = upsertDownloadRecord({
    id: recordId,
    shareKey,
    shareText,
    resourceName: "百度网盘分享",
    downloadDir: defaultBaiduNetdiskDownloadDir,
    state: "pending",
    skippedExisting: false,
    createdAt: readDownloadRecords().find((item) => item.id === recordId)?.createdAt ?? now,
    updatedAt: now,
    startedAt: now,
  });

  let result: Omit<BaiduNetdiskShareDownloadResult, "downloadDir">;

  try {
    result = await downloadBaiduNetdiskShare({
      shareText,
      port: cdpPort(config),
      downloadDir: defaultBaiduNetdiskDownloadDir,
    });
  } catch (error) {
    const message = readableError(error);
    upsertDownloadRecord({
      ...record,
      state: "failed",
      error: message,
    });
    throw Object.assign(new Error(message), { cause: error });
  }

  const state: BaiduNetdiskDownloadState =
    result.completed || result.skippedExisting ? "completed" : "downloading";
  upsertDownloadRecord({
    ...record,
    resourceName: result.share.name,
    downloadDir: defaultBaiduNetdiskDownloadDir,
    localPath: result.localPath,
    state,
    skippedExisting: result.skippedExisting,
    error: undefined,
    completedAt: state === "completed" ? new Date().toISOString() : undefined,
  });

  return {
    ...result,
    downloadDir: defaultBaiduNetdiskDownloadDir,
  } satisfies BaiduNetdiskShareDownloadResult;
}

export async function ensureBaiduNetdiskShareDownloaded(
  request: BaiduNetdiskEnsureDownloadedRequest,
): Promise<BaiduNetdiskDownloadRecord> {
  const normalizedRequest = normalizeEnsureDownloadRequest(request);
  const shareKey = shareKeyFromText(normalizedRequest.shareText);
  const id = createRecordId(shareKey, normalizedRequest.resourceName);
  const activePromise = activeDownloadPromises.get(id);

  if (activePromise) {
    return activePromise;
  }

  const promise = ensureBaiduNetdiskShareDownloadedOnce(id, shareKey, normalizedRequest).finally(
    () => {
      activeDownloadPromises.delete(id);
    },
  );
  activeDownloadPromises.set(id, promise);

  return promise;
}

async function ensureBaiduNetdiskShareDownloadedOnce(
  id: string,
  shareKey: string,
  request: BaiduNetdiskEnsureDownloadedRequest,
): Promise<BaiduNetdiskDownloadRecord> {
  const existingRecord = readDownloadRecords().find((record) => record.id === id);
  const localPath = playletDir(request.localEpisodeVideoRoot, request.resourceName);
  const now = new Date().toISOString();
  let record = upsertDownloadRecord({
    id,
    shareKey,
    shareText: request.shareText,
    resourceName: request.resourceName,
    localEpisodeVideoRoot: request.localEpisodeVideoRoot,
    episodeCount: request.episodeCount,
    downloadDir: request.localEpisodeVideoRoot,
    localPath,
    state: existingRecord?.state ?? "pending",
    skippedExisting: existingRecord?.skippedExisting ?? false,
    error: undefined,
    createdAt: existingRecord?.createdAt ?? now,
    updatedAt: now,
    startedAt: existingRecord?.startedAt,
    completedAt: existingRecord?.completedAt,
  });

  record = upsertDownloadRecord({
    ...record,
    state: "downloading",
    skippedExisting: false,
    error: undefined,
    startedAt: record.startedAt ?? new Date().toISOString(),
    completedAt: undefined,
  });

  try {
    const config = readConfig();
    const {
      downloadBaiduNetdiskShare,
      getBaiduNetdiskDownloadTaskStatus,
    } = await importBaiduNetdiskDownloadRuntimePackage();
    const port = cdpPort(config);
    const result = await ensureBaiduNetdiskEpisodeVideos({
      shareText: request.shareText,
      resourceName: request.resourceName,
      localEpisodeVideoRoot: request.localEpisodeVideoRoot,
      episodeCount: request.episodeCount,
      downloadDir: request.localEpisodeVideoRoot,
      sourceLocalPath: existingRecord?.localPath,
      downloadTaskName: existingRecord?.resourceName,
      downloadShare: (downloadRequest) =>
        downloadBaiduNetdiskShare({
          shareText: downloadRequest.shareText,
          resourceName: downloadRequest.resourceName,
          expectedEpisodeCount: downloadRequest.expectedEpisodeCount,
          port,
          downloadDir: downloadRequest.downloadDir,
        }),
      getDownloadTaskStatus: (statusRequest) =>
        getBaiduNetdiskDownloadTaskStatus({
          port,
          targetName: statusRequest.targetName,
        }),
      onLog: (message) => console.log(message.replace("[video-assets]", "[baidu]")),
      onProgress: (progress) => {
        record = upsertDownloadRecord({
          ...record,
          downloadDir: progress.downloadRoot ?? record.downloadDir,
          localPath: progress.localPath ?? record.localPath,
          nativeStatus: progress.nativeStatus ?? record.nativeStatus,
          progressPercent: progress.progressPercent ?? record.progressPercent,
          transferredBytes: progress.transferredBytes ?? record.transferredBytes,
          totalBytes: progress.totalBytes ?? record.totalBytes,
          speedText: progress.speedText ?? record.speedText,
          skippedExisting: progress.skippedExisting ?? record.skippedExisting,
          state: progress.phase === "existing-complete" || progress.phase === "standardized"
            ? "completed"
            : "downloading",
          error: undefined,
        });
      },
    });

    return upsertDownloadRecord({
      ...record,
      resourceName: request.resourceName,
      localPath: result.localPath,
      progressPercent: 100,
      state: "completed",
      skippedExisting: result.skippedExisting,
      error: undefined,
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = readableError(error);
    upsertDownloadRecord({
      ...record,
      state: "failed",
      error: message,
    });
    throw Object.assign(new Error(message), { cause: error });
  }
}

function readableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalizedMessage = message.replace(/^(Error:\s*)+/g, "");
  const transferJsonMatch = normalizedMessage.match(/保存分享到网盘失败：(\{.*\})/);

  if (transferJsonMatch) {
    try {
      const data = JSON.parse(transferJsonMatch[1]) as {
        errno?: number;
        errmsg?: string;
        show_msg?: string;
        message?: string;
        request_id?: string | number;
      };
      const apiMessage = data.show_msg || data.errmsg || data.message || "";

      if (
        data.errno === -6 ||
        apiMessage.includes("账户已过期") ||
        apiMessage.includes("重新登陆")
      ) {
        return "百度网盘账号登录已过期，请在百度网盘客户端重新登录后再下载。";
      }

      return `保存分享到网盘失败：${apiMessage || "百度接口返回异常"}；errno=${data.errno ?? "-"}${
        data.request_id ? `；request_id=${data.request_id}` : ""
      }`;
    } catch {
      return normalizedMessage;
    }
  }

  if (normalizedMessage.includes("账户已过期") || normalizedMessage.includes("重新登陆")) {
    return "百度网盘账号登录已过期，请在百度网盘客户端重新登录后再下载。";
  }

  return normalizedMessage;
}

function downloadRecordsResult(): BaiduNetdiskDownloadRecordResult {
  const repository = getDownloadRecordsRepository();
  return {
    path: repository.databasePath,
    records: repository.list(),
  };
}

function clearDownloadRecords(): BaiduNetdiskDownloadRecordResult {
  getDownloadRecordsRepository().clear();
  broadcastDownloadRecordsChanged();
  return downloadRecordsResult();
}

function broadcastDownloadRecordsChanged() {
  const result = downloadRecordsResult();

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("baidu-netdisk:downloads:changed", result);
    }
  }
}

export function registerBaiduNetdiskPlatformHandlers(
  options: RegisterBaiduNetdiskPlatformHandlersOptions = {},
) {
  ipcMain.handle(
    "baidu-netdisk:config:get",
    (): BaiduNetdiskConfigResult => ({
      config: readConfig(),
      path: configPath(),
    }),
  );

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
  ipcMain.handle("baidu-netdisk:downloads:list", () => downloadRecordsResult());
  ipcMain.handle("baidu-netdisk:downloads:clear", () => clearDownloadRecords());
  ipcMain.handle("baidu-netdisk:share:download", (_event, request) =>
    downloadShare(request as BaiduNetdiskShareDownloadRequest | undefined),
  );
  ipcMain.handle("baidu-netdisk:share:ensure-downloaded", (_event, request) =>
    ensureBaiduNetdiskShareDownloaded(request as BaiduNetdiskEnsureDownloadedRequest),
  );
  ipcMain.handle("baidu-netdisk:window:open", (_event, platformId: PlatformId) => {
    options.openWindow?.(platformId);
    return true;
  });
}
