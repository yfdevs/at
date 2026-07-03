import { BrowserWindow, ipcMain } from "electron";
import Store from "electron-store";
import { createHash } from "node:crypto";
import { access, cp, mkdir, readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type BaiduNetdiskConfig = {
  debugPort: string;
  executablePath: string;
};

type BaiduNetdiskStore = {
  config: Partial<BaiduNetdiskConfig> & Record<string, string | undefined>;
  downloads: BaiduNetdiskDownloadRecord[];
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

export type BaiduNetdiskDownloadState = "pending" | "downloading" | "completed" | "failed";

export type BaiduNetdiskDownloadRecord = {
  id: string;
  shareKey: string;
  shareText: string;
  resourceName: string;
  localEpisodeVideoRoot?: string;
  episodeCount?: number;
  downloadDir: string;
  localPath?: string;
  progressPercent?: number;
  transferredBytes?: number;
  totalBytes?: number;
  speedText?: string;
  nativeStatus?: string;
  state: BaiduNetdiskDownloadState;
  skippedExisting: boolean;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
};

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

const defaultBaiduNetdiskConfig: BaiduNetdiskConfig = {
  debugPort: "9337",
  executablePath: "",
};

const defaultBaiduNetdiskDownloadDir = "D:\\BaiduNetdiskDownload";

const require = createRequire(import.meta.url);
let store: Store<BaiduNetdiskStore> | null = null;
const activeDownloadPromises = new Map<string, Promise<BaiduNetdiskDownloadRecord>>();

function getStore() {
  if (!store) {
    store = new Store<BaiduNetdiskStore>({
      name: "baidu-netdisk-config",
      defaults: {
        config: defaultBaiduNetdiskConfig,
        downloads: [],
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

function readDownloadRecords() {
  return [...(getStore().get("downloads") ?? [])].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

function writeDownloadRecords(records: BaiduNetdiskDownloadRecord[]) {
  getStore().set("downloads", records.slice(0, 100));
  broadcastDownloadRecordsChanged();
}

function upsertDownloadRecord(
  record: BaiduNetdiskDownloadRecord,
): BaiduNetdiskDownloadRecord {
  const records = readDownloadRecords();
  const nextRecord = {
    ...record,
    updatedAt: new Date().toISOString(),
  };
  const nextRecords = [
    nextRecord,
    ...records.filter((item) => item.id !== record.id),
  ];

  writeDownloadRecords(nextRecords);
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
      shareText.match(/(?:提取码|密码|pwd)[:：\s]*([a-zA-Z0-9]{4})/)?.[1] ??
      "";

    return [
      url.origin.toLowerCase(),
      url.pathname.replace(/\/+$/, ""),
      pwd.toLowerCase(),
    ].filter(Boolean).join("|");
  } catch {
    return link;
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

async function pathExists(filePath: string) {
  return access(filePath).then(() => true, () => false);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function listLocalEpisodeFiles(root: string, resourceName: string) {
  const directory = playletDir(root, resourceName);
  const escapedResourceName = escapeRegExp(resourceName);
  const patterns = [
    new RegExp(`^${escapedResourceName}\\s*[-_—–]?\\s*第(\\d+)集\\.mp4$`, "i"),
    new RegExp(`^${escapedResourceName}\\s*(\\d+)\\.mp4$`, "i"),
  ];
  const scanDirs = [
    directory,
    path.join(directory, "成片"),
    path.join(directory, "视频"),
  ];
  const files: Array<{ index: number; file: string; size: number }> = [];

  for (const scanDir of scanDirs) {
    const entries = await readdir(scanDir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".mp4")) continue;

      const match = patterns
        .map((pattern) => pattern.exec(entry.name))
        .find((result): result is RegExpExecArray => result !== null);
      if (!match) continue;

      const index = Number(match[1]);
      const file = path.join(scanDir, entry.name);
      const fileStat = await stat(file).catch(() => undefined);
      if (!fileStat?.isFile() || fileStat.size <= 0) continue;

      files.push({ index, file, size: fileStat.size });
    }
  }

  return files.sort((left, right) => left.index - right.index);
}

async function directorySize(directory: string): Promise<number> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  let total = 0;

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      total += await directorySize(entryPath);
      continue;
    }

    if (!entry.isFile()) continue;

    const fileStat = await stat(entryPath).catch(() => undefined);
    total += fileStat?.isFile() ? fileStat.size : 0;
  }

  return total;
}

async function downloadedResourceSize(root: string, resourceName: string) {
  return directorySize(playletDir(root, resourceName));
}

function isCompleteEpisodeFileSet(
  files: Array<{ index: number; file: string; size: number }>,
  episodeCount: number,
) {
  const normalizedEpisodeCount = Number(episodeCount);
  if (!Number.isInteger(normalizedEpisodeCount) || normalizedEpisodeCount <= 0) {
    return false;
  }

  const expectedIndexes = Array.from({ length: normalizedEpisodeCount }, (_, index) => index + 1);
  const actualIndexSet = new Set(files.map((file) => file.index));

  return expectedIndexes.every((index) => actualIndexSet.has(index));
}

async function hasCompleteLocalEpisodeVideos(
  root: string,
  resourceName: string,
  episodeCount: number,
) {
  if (!(await pathExists(playletDir(root, resourceName)))) {
    return false;
  }

  const files = await listLocalEpisodeFiles(root, resourceName);
  return isCompleteEpisodeFileSet(files, episodeCount);
}

function fileSetSignature(files: Array<{ index: number; file: string; size: number }>) {
  return files
    .map((file) => `${file.index}:${file.size}`)
    .join("|");
}

function episodeFileSummary(files: Array<{ index: number; file: string; size: number }>) {
  const indexes = [...new Set(files.map((file) => file.index))].sort((left, right) => left - right);

  return {
    count: indexes.length,
    min: indexes[0],
    max: indexes[indexes.length - 1],
  };
}

async function copyDownloadedResourceToWechatRoot(
  sourceRoot: string,
  targetRoot: string,
  resourceName: string,
) {
  const sourceDir = playletDir(sourceRoot, resourceName);
  const targetDir = playletDir(targetRoot, resourceName);

  if (path.resolve(sourceDir).toLowerCase() === path.resolve(targetDir).toLowerCase()) {
    return targetDir;
  }

  console.log(`[baidu] 下载完成，复制到微信剧集目录：${sourceDir} -> ${targetDir}`);
  await mkdir(path.dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, {
    recursive: true,
    force: true,
  });

  return targetDir;
}

function taskProgressPercent(finishSize?: number, size?: number) {
  if (!Number.isFinite(finishSize) || !Number.isFinite(size) || !size || size <= 0) {
    return undefined;
  }

  return Math.round(Math.min(Math.max((finishSize! / size) * 100, 0), 1000)) / 10;
}

function normalizeDownloadProgress(transferredBytes: number, totalBytes: number | undefined) {
  if (!Number.isFinite(transferredBytes) || transferredBytes <= 0) {
    return {
      progressPercent: undefined,
      transferredBytes: undefined,
      totalBytes: Number.isFinite(totalBytes) && totalBytes && totalBytes > 0 ? totalBytes : undefined,
    };
  }

  if (!Number.isFinite(totalBytes) || !totalBytes || totalBytes <= 0) {
    return {
      progressPercent: undefined,
      transferredBytes,
      totalBytes: undefined,
    };
  }

  if (transferredBytes > totalBytes) {
    return {
      progressPercent: undefined,
      transferredBytes,
      totalBytes: undefined,
    };
  }

  return {
    progressPercent: taskProgressPercent(transferredBytes, totalBytes),
    transferredBytes,
    totalBytes,
  };
}

async function localTransferredBytes(roots: string[], resourceName: string) {
  const sizes = await Promise.all(
    roots.map((root) => downloadedResourceSize(root, resourceName).catch(() => 0)),
  );

  return Math.max(0, ...sizes);
}

function rootFromLocalPath(localPath: string | undefined, resourceName: string) {
  if (!localPath?.trim()) return undefined;

  const normalizedLocalPath = path.resolve(localPath);
  if (path.basename(normalizedLocalPath) !== resourceName) return undefined;

  return path.dirname(normalizedLocalPath);
}

async function waitForCompleteLocalEpisodeVideos(options: {
  id: string;
  record: BaiduNetdiskDownloadRecord;
  targetRoot: string;
  resourceName: string;
  episodeCount: number;
  sourceRoot?: string;
  port?: number;
  timeoutMs?: number;
}) {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 12 * 60 * 60 * 1000;
  const stableSignatures = new Map<string, { signature: string; count: number }>();
  let lastProgressLogAt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    let record = readDownloadRecords().find((item) => item.id === options.id) ?? options.record;
    const roots = [
      options.targetRoot,
      options.sourceRoot,
      rootFromLocalPath(record.localPath, options.resourceName),
    ].filter((item): item is string => Boolean(item?.trim()));
    const uniqueRoots = [...new Set(roots.map((root) => path.resolve(root)))];

    let bestLocalSummary: ReturnType<typeof episodeFileSummary> | undefined;

    for (const root of uniqueRoots) {
      const files = await listLocalEpisodeFiles(root, options.resourceName);
      const summary = episodeFileSummary(files);
      if (!bestLocalSummary || summary.count > bestLocalSummary.count) {
        bestLocalSummary = summary;
      }
      const complete = isCompleteEpisodeFileSet(files, options.episodeCount);
      const signature = fileSetSignature(files);
      const stable = stableSignatures.get(root);
      const nextStable = {
        signature,
        count: complete && stable?.signature === signature ? stable.count + 1 : complete ? 1 : 0,
      };
      stableSignatures.set(root, nextStable);

      if (complete && nextStable.count >= 2) {
        if (path.resolve(root).toLowerCase() !== path.resolve(options.targetRoot).toLowerCase()) {
          await copyDownloadedResourceToWechatRoot(root, options.targetRoot, options.resourceName);
        }

        return playletDir(options.targetRoot, options.resourceName);
      }
    }

    if (options.port) {
      const { getBaiduNetdiskDownloadTaskStatus } = await importBaiduNetdiskDownloadRuntimePackage();
      const taskStatus = await getBaiduNetdiskDownloadTaskStatus({
        port: options.port,
        targetName: options.resourceName,
      }).catch(() => undefined);

      if (taskStatus) {
        const localBytes = await localTransferredBytes(uniqueRoots, options.resourceName);
        const transferredBytes = Math.max(taskStatus.finishSize ?? 0, localBytes);
        const progress = normalizeDownloadProgress(transferredBytes, taskStatus.size);
        record = upsertDownloadRecord({
          ...record,
          nativeStatus: taskStatus.status,
          ...progress,
          speedText: taskStatus.rate,
          localPath: taskStatus.localPath || record.localPath,
          error: undefined,
        });

        if (Date.now() - lastProgressLogAt > 15000) {
          const progressText = progress.progressPercent === undefined ? "未知" : `${progress.progressPercent}%`;
          console.log(
            `[baidu] 下载进度：${options.resourceName} ${progressText}` +
              (bestLocalSummary
                ? ` 本地识别=${bestLocalSummary.count}/${options.episodeCount}集` +
                  (bestLocalSummary.min !== undefined ? `(${bestLocalSummary.min}-${bestLocalSummary.max})` : "")
                : "") +
              (taskStatus.rate ? ` ${taskStatus.rate}` : "") +
              (taskStatus.status ? ` status=${taskStatus.status}` : ""),
          );
          lastProgressLogAt = Date.now();
        }

        if (taskStatus.completed) {
          for (const root of uniqueRoots) {
            if (await hasCompleteLocalEpisodeVideos(root, options.resourceName, options.episodeCount)) {
              if (path.resolve(root).toLowerCase() !== path.resolve(options.targetRoot).toLowerCase()) {
                await copyDownloadedResourceToWechatRoot(root, options.targetRoot, options.resourceName);
              }

              return playletDir(options.targetRoot, options.resourceName);
            }
          }
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  throw new Error(`等待百度网盘资源下载完成超时：${playletDir(options.targetRoot, options.resourceName)}`);
}

function cdpPort(config = readConfig()) {
  return Number.parseInt(config.debugPort, 10);
}

async function importBaiduNetdiskRuntimePackage() {
  const packageJsonPath = require.resolve("@drama/baidu-netdisk-automation/package.json");
  const entryUrl = pathToFileURL(path.join(path.dirname(packageJsonPath), "dist", "index.mjs"));
  entryUrl.searchParams.set("cacheBust", String(Date.now()));

  return import(/* @vite-ignore */ entryUrl.href) as Promise<{
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
  const packageJsonPath = require.resolve("@drama/baidu-netdisk-automation/package.json");
  const entryUrl = pathToFileURL(
    path.join(path.dirname(packageJsonPath), "dist", "download-baidu-folder.mjs"),
  );
  entryUrl.searchParams.set("cacheBust", String(Date.now()));

  return import(/* @vite-ignore */ entryUrl.href) as Promise<{
    downloadBaiduNetdiskShare: (options: {
      shareText: string;
      resourceName?: string;
      expectedEpisodeCount?: number;
      port: number;
      downloadDir: string;
    }) => Promise<Omit<BaiduNetdiskShareDownloadResult, "downloadDir">>;
    getBaiduNetdiskDownloadTaskStatus: (options: {
      port: number;
      targetName: string;
    }) => Promise<{
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
    action: currentStatus.appRunning ? "restart" as const : "start" as const,
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
  let record = upsertDownloadRecord({
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
    record = upsertDownloadRecord({
      ...record,
      state: "failed",
      error: readableError(error),
    });
    throw error;
  }

  const state: BaiduNetdiskDownloadState = result.completed || result.skippedExisting
    ? "completed"
    : "downloading";
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

  if (
    await hasCompleteLocalEpisodeVideos(
      request.localEpisodeVideoRoot,
      request.resourceName,
      request.episodeCount,
    )
  ) {
    return upsertDownloadRecord({
      ...record,
      state: "completed",
      skippedExisting: true,
      error: undefined,
      completedAt: new Date().toISOString(),
    });
  }

  if (existingRecord?.state === "downloading") {
    try {
      const completedPath = await waitForCompleteLocalEpisodeVideos({
        id,
        record,
        targetRoot: request.localEpisodeVideoRoot,
        sourceRoot: rootFromLocalPath(existingRecord.localPath, request.resourceName) ?? existingRecord.downloadDir,
        resourceName: request.resourceName,
        episodeCount: request.episodeCount,
        port: cdpPort(readConfig()),
      });

      return upsertDownloadRecord({
        ...record,
        localPath: completedPath,
        state: "completed",
        error: undefined,
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      record = upsertDownloadRecord({
        ...record,
        state: "failed",
        error: readableError(error),
      });
      throw error;
    }
  }

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
    const { downloadBaiduNetdiskShare } = await importBaiduNetdiskDownloadRuntimePackage();
    const result = await downloadBaiduNetdiskShare({
      shareText: request.shareText,
      resourceName: request.resourceName,
      expectedEpisodeCount: request.episodeCount,
      port: cdpPort(config),
      downloadDir: request.localEpisodeVideoRoot,
    });
    record = upsertDownloadRecord({
      ...record,
      resourceName: result.share.name || request.resourceName,
      downloadDir: result.downloadRoot ?? request.localEpisodeVideoRoot,
      localPath: result.localPath ?? record.localPath,
      error: undefined,
    });
    const completedPath = await waitForCompleteLocalEpisodeVideos({
      id,
      record,
      targetRoot: request.localEpisodeVideoRoot,
      sourceRoot: rootFromLocalPath(result.localPath, result.share.name || request.resourceName) ?? result.downloadRoot,
      resourceName: result.share.name || request.resourceName,
      episodeCount: request.episodeCount,
      port: cdpPort(config),
    });

    return upsertDownloadRecord({
      ...record,
      resourceName: result.share.name || request.resourceName,
      downloadDir: result.downloadRoot ?? request.localEpisodeVideoRoot,
      localPath: completedPath,
      progressPercent: 100,
      state: "completed",
      skippedExisting: result.skippedExisting,
      error: undefined,
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    record = upsertDownloadRecord({
      ...record,
      state: "failed",
      error: readableError(error),
    });
    throw error;
  }
}

function readableError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function downloadRecordsResult(): BaiduNetdiskDownloadRecordResult {
  return {
    records: readDownloadRecords(),
    path: configPath(),
  };
}

function clearDownloadRecords(): BaiduNetdiskDownloadRecordResult {
  writeDownloadRecords([]);
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

export function registerBaiduNetdiskPlatformHandlers() {
  ipcMain.handle("baidu-netdisk:config:get", (): BaiduNetdiskConfigResult => ({
    config: readConfig(),
    path: configPath(),
  }));

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
}
