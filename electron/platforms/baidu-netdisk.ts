import { BrowserWindow, ipcMain } from "electron";
import Store from "electron-store";
import { ensureAiPoster, VideoTranscodeQueue } from "@drama/drama-media-assets";
import { ensureBaiduNetdiskEpisodeVideos } from "@drama/drama-media-assets/baidu-netdisk";
import { formatDateKey } from "@drama/automation-logging";
import { createHash } from "node:crypto";
import { lstat, readdir, rm, statfs, utimes } from "node:fs/promises";
import path from "node:path";
import {
  BaiduNetdiskDownloadRecordsRepository,
  type BaiduNetdiskDownloadRecord,
  type BaiduNetdiskDownloadState,
} from "../storage/baidu-netdisk";
import {
  createConfiguredAiClient,
  getConfiguredAiImageModel,
  getConfiguredBaiduNetdiskDownloadTimeoutMs,
  isAiPosterFallbackEnabled,
  resolveGlobalPlatformDirectories,
} from "../global-app-config";
import { resolveFromAppRoot } from "./shared";
import { createElectronPlatformLogger } from "../platform-logger";
import { runRuntimeAssetCleanup } from "../runtime-asset-cleanup";

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
  expectedOwnershipImages?: number;
  expectedOwnershipFiles?: number;
  expectedPosterImages?: number;
  expectedAiProductionProofFiles?: number;
  remoteVideos?: BaiduNetdiskRemoteVideoListing;
  inferredEpisodeCount?: number;
  completed: boolean;
  skippedExisting: boolean;
  downloadDir: string;
};

type BaiduNetdiskShareDownloadRequest = {
  shareText?: string;
};

export type { BaiduNetdiskDownloadRecord, BaiduNetdiskDownloadState };

export type BaiduNetdiskEnsureDownloadedRequest = {
  requesterPlatform?: string;
  shareText: string;
  resourceName: string;
  localEpisodeVideoRoot: string;
  episodeCount?: number;
  inferEpisodeCount?: boolean;
  downloadEpisodeVideos?: boolean;
  downloadAssetMaterials?: boolean;
  forceAssetDownload?: boolean;
  requiredOwnership?: {
    minimumImages?: number;
  };
  requiredOwnershipFiles?: number;
  requiredPosterImages?: number;
  posterFallback?: {
    title?: string;
    summary: string;
  };
  requiredAiProductionProofFiles?: number;
  mergeOwnershipMaterials?: boolean;
  videoTranscode?: {
    runDataDir: string;
    maxFileMegabytes: number;
    targetFileMegabytes: number;
    concurrency: number;
    threadsPerJob: number;
  };
  onStableEpisodeFiles?: (files: Array<{
    index: number;
    file: string;
    size: number;
    modifiedAtMs: number;
  }>) => void;
};

function baiduNetdiskRunDataDir() {
  return resolveGlobalPlatformDirectories("baidu-netdisk", {
    runDataDir: resolveFromAppRoot(".drama-runs/baidu-netdisk"),
    localMaterialRoot: defaultBaiduNetdiskDownloadDir,
  }).runDataDir;
}

function baiduNetdiskLogDir() {
  return path.join(baiduNetdiskRunDataDir(), "logs");
}

function baiduNetdiskLogFilePath() {
  return path.join(baiduNetdiskLogDir(), `app-${formatDateKey()}.log`);
}

function baiduNetdiskLogger(
  scope = "netdisk",
  context?: Record<string, unknown>,
) {
  return createElectronPlatformLogger({
    platform: "baidu-netdisk",
    scope,
    context,
    logDir: baiduNetdiskLogDir(),
    retentionDays: 3,
  });
}

export type BaiduNetdiskDownloadRecordResult = {
  records: BaiduNetdiskDownloadRecord[];
  path: string;
};

const defaultBaiduNetdiskConfig: BaiduNetdiskConfig = {
  debugPort: "9337",
  executablePath: "",
};

const defaultBaiduNetdiskDownloadDir = "D:\\BaiduNetdiskDownload";

let store: Store<BaiduNetdiskStore> | null = null;
let downloadRecordsRepository: BaiduNetdiskDownloadRecordsRepository | null = null;
type StableEpisodeFilesListener = NonNullable<
  BaiduNetdiskEnsureDownloadedRequest["onStableEpisodeFiles"]
>;

type ActiveDownloadOperation = {
  promise: Promise<BaiduNetdiskDownloadRecord>;
  stableEpisodeFilesListeners: Set<StableEpisodeFilesListener>;
  localPath: string;
};

const activeDownloadOperations = new Map<string, ActiveDownloadOperation>();
const appVideoTranscodeQueues = new Map<number, VideoTranscodeQueue>();
const monitoredEpisodeVideoRoots = new Set<string>();
const pendingDownloadPaths = new Set<string>();
const diskCleanupUsageThreshold = 0.8;
const stalePlayletAgeMs = 2 * 60 * 60 * 1000;
const diskCleanupIntervalMs = 5 * 60 * 1000;
let diskCleanupTimer: NodeJS.Timeout | null = null;
let diskCleanupOperation: Promise<void> | null = null;
let baiduCdpOperationTail: Promise<void> = Promise.resolve();
let queuedBaiduCdpOperations = 0;

function normalizedPathKey(value: string) {
  return path.resolve(value).toLowerCase();
}

function isSafeEpisodeVideoRootOnDriveD(rootPath: string) {
  const resolvedRoot = path.resolve(rootPath);
  const driveRoot = path.parse(resolvedRoot).root;
  return driveRoot.toLowerCase() === "d:\\" && normalizedPathKey(resolvedRoot) !== normalizedPathKey(driveRoot);
}

async function latestTreeModifiedAtMs(targetPath: string): Promise<number> {
  const targetStat = await lstat(targetPath);
  let latest = targetStat.mtimeMs;
  if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) return latest;

  const entries = await readdir(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name);
    const entryStat = await lstat(entryPath).catch(() => undefined);
    if (!entryStat) continue;
    latest = Math.max(latest, entryStat.mtimeMs);
    if (entryStat.isDirectory() && !entryStat.isSymbolicLink()) {
      latest = Math.max(latest, await latestTreeModifiedAtMs(entryPath).catch(() => entryStat.mtimeMs));
    }
  }
  return latest;
}

async function driveDUsageRatio() {
  const stats = await statfs("D:\\", { bigint: true });
  if (stats.blocks <= 0n) return 0;
  return Number(stats.blocks - stats.bfree) / Number(stats.blocks);
}

async function cleanupStalePlayletDirectories(rootPath: string, protectedPaths: Set<string>) {
  if (!isSafeEpisodeVideoRootOnDriveD(rootPath)) {
    baiduNetdiskLogger("storage").warn("已跳过不安全的剧集目录清理", { path: rootPath });
    return;
  }

  const usageRatio = await driveDUsageRatio();
  if (usageRatio < diskCleanupUsageThreshold) return;

  const resolvedRoot = path.resolve(rootPath);
  const entries = await readdir(resolvedRoot, { withFileTypes: true }).catch(() => []);
  const cutoffMs = Date.now() - stalePlayletAgeMs;
  let deletedCount = 0;

  baiduNetdiskLogger("storage").warn("磁盘空间不足，开始清理过期剧目目录", {
    path: resolvedRoot,
    usedPercent: Number((usageRatio * 100).toFixed(1)),
  });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const candidate = path.resolve(resolvedRoot, entry.name);
    if (path.dirname(candidate).toLowerCase() !== resolvedRoot.toLowerCase()) continue;
    const candidateKey = normalizedPathKey(candidate);
    const activePaths = [...activeDownloadOperations.values()]
      .some((operation) => normalizedPathKey(operation.localPath) === candidateKey);
    if (protectedPaths.has(candidateKey) || pendingDownloadPaths.has(candidateKey) || activePaths) continue;

    const candidateStat = await lstat(candidate).catch(() => undefined);
    if (!candidateStat?.isDirectory() || candidateStat.isSymbolicLink()) continue;
    const latestModifiedAtMs = await latestTreeModifiedAtMs(candidate).catch(() => candidateStat.mtimeMs);
    if (latestModifiedAtMs > cutoffMs) continue;

    await rm(candidate, { recursive: true, force: true });
    deletedCount += 1;
    baiduNetdiskLogger("storage").warn("已删除过期剧目目录", {
      path: candidate,
      lastModifiedAt: new Date(latestModifiedAtMs).toISOString(),
    });
  }

  baiduNetdiskLogger("storage").info("过期剧目目录清理完成", {
    path: resolvedRoot,
    deletedCount,
  });
}

function runDiskCleanup(protectedExtraPaths: string[] = []) {
  if (diskCleanupOperation) return diskCleanupOperation;
  const protectedPaths = new Set([
    ...[...activeDownloadOperations.values()].map((operation) => normalizedPathKey(operation.localPath)),
    ...protectedExtraPaths.map(normalizedPathKey),
  ]);
  diskCleanupOperation = (async () => {
    const usageRatio = await driveDUsageRatio().catch(() => 0);
    if (usageRatio >= diskCleanupUsageThreshold) {
      await runRuntimeAssetCleanup({
        reason: "disk-pressure",
        diskPressure: true,
      });
    }

    for (const rootPath of monitoredEpisodeVideoRoots) {
      await cleanupStalePlayletDirectories(rootPath, protectedPaths).catch((error) => {
        baiduNetdiskLogger("storage").warn("剧目目录检查或清理失败", {
          path: rootPath,
          error,
        });
      });
    }
  })().finally(() => {
    diskCleanupOperation = null;
  });
  return diskCleanupOperation;
}

function startDiskCleanupMonitor() {
  if (diskCleanupTimer) return;
  diskCleanupTimer = setInterval(() => {
    void runDiskCleanup();
  }, diskCleanupIntervalMs);
  diskCleanupTimer.unref();
}

function runBaiduCdpOperationExclusive<T>(label: string, operation: () => Promise<T>): Promise<T> {
  queuedBaiduCdpOperations += 1;
  const queuePosition = queuedBaiduCdpOperations;
  if (queuePosition > 1) {
    baiduNetdiskLogger("netdisk").info("网盘操作正在排队", {
      action: label,
      ahead: queuePosition - 1,
    });
  }

  const previous = baiduCdpOperationTail;
  const current = previous
    .catch(() => undefined)
    .then(async () => {
      baiduNetdiskLogger("netdisk").info("网盘操作开始", { action: label });
      try {
        return await operation();
      } finally {
        queuedBaiduCdpOperations = Math.max(0, queuedBaiduCdpOperations - 1);
        baiduNetdiskLogger("netdisk").info("网盘操作结束", { action: label });
      }
    });
  baiduCdpOperationTail = current.then(
    () => undefined,
    () => undefined,
  );
  return current;
}

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

function uniqueBaiduDownloadDir(resourceName: string, shareKey: string) {
  const safeName = resourceName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim() || "资源";
  const suffix = createHash("sha1").update(shareKey).digest("hex").slice(0, 10);
  return path.join(defaultBaiduNetdiskDownloadDir, `${safeName}__${suffix}`);
}

function assertDisposableBaiduDownloadDir(downloadDir: string) {
  const root = path.resolve(defaultBaiduNetdiskDownloadDir);
  const target = path.resolve(downloadDir);
  const relative = path.relative(root, target);

  if (
    !relative
    || relative.startsWith("..")
    || path.isAbsolute(relative)
    || !/__[\da-f]{10}$/i.test(path.basename(target))
  ) {
    throw new Error(`拒绝清理非独立百度下载目录：${target}`);
  }
}

async function cleanupBaiduNetdiskDownloadArtifacts(options: {
  downloadDir: string;
  targetName: string;
  port: number;
}) {
  try {
    assertDisposableBaiduDownloadDir(options.downloadDir);
  } catch (error) {
    baiduNetdiskLogger("storage").warn("已跳过不安全的临时目录清理", { error });
    return;
  }

  const { controlBaiduNetdiskDownloadTask } = await importBaiduNetdiskDownloadRuntimePackage();
  const downloadTaskNames = [
    options.targetName,
    "视频",
    "权属",
    "工程",
    "封面",
    "海报",
    "AI制作证明",
  ];
  let cleanupAttemptCount = 0;
  for (const targetName of downloadTaskNames) {
    try {
      await runBaiduCdpOperationExclusive(`清理百度下载任务：${targetName}`, () =>
        controlBaiduNetdiskDownloadTask({
          port: options.port,
          targetName,
          action: "delete",
          expectedDownloadRoot: options.downloadDir,
        }),
      );
      cleanupAttemptCount += 1;
    } catch {
      // A material category may not have created its own native download task.
    }
  }
  baiduNetdiskLogger("download").info("百度客户端下载任务清理完成", {
    resourceName: options.targetName,
    cleanupAttemptCount,
  });

  try {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        rm(options.downloadDir, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 500,
        }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("清理临时下载目录等待超过 30 秒")),
            30_000,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    baiduNetdiskLogger("storage").info("临时下载目录已清理", { path: options.downloadDir });
  } catch (error) {
    baiduNetdiskLogger("storage").warn("临时下载目录清理失败", {
      path: options.downloadDir,
      error,
    });
  }
}

function normalizeEnsureDownloadRequest(
  request: BaiduNetdiskEnsureDownloadedRequest,
): BaiduNetdiskEnsureDownloadedRequest {
  const shareText = request.shareText.trim();
  const resourceName = sanitizeWindowsName(request.resourceName);
  const localEpisodeVideoRoot = request.localEpisodeVideoRoot.trim();
  const episodeCount = Number(request.episodeCount);
  const inferEpisodeCount = request.inferEpisodeCount === true;
  const downloadEpisodeVideos = request.downloadEpisodeVideos !== false;

  if (!shareText) {
    throw new Error("百度网盘分享链接不能为空。");
  }
  if (!resourceName) {
    throw new Error("百度网盘资源名称不能为空。");
  }
  if (!localEpisodeVideoRoot) {
    throw new Error("本地剧集视频根目录不能为空。");
  }
  if (
    (!Number.isInteger(episodeCount)
      || (downloadEpisodeVideos ? episodeCount <= 0 : episodeCount < 0))
    && !(downloadEpisodeVideos && inferEpisodeCount)
  ) {
    throw new Error("剧集数量必须是正整数，或启用自动识别集数。");
  }

  return {
    shareText,
    resourceName,
    localEpisodeVideoRoot,
    episodeCount: Number.isInteger(episodeCount) && episodeCount >= 0
      ? episodeCount
      : undefined,
    inferEpisodeCount,
    downloadEpisodeVideos,
    downloadAssetMaterials: request.downloadAssetMaterials,
    forceAssetDownload: request.forceAssetDownload,
    requiredOwnership: request.requiredOwnership,
    requiredOwnershipFiles: request.requiredOwnershipFiles,
    requiredPosterImages: request.requiredPosterImages,
    posterFallback: request.posterFallback
      ? {
          title: request.posterFallback.title?.trim() || resourceName,
          summary: request.posterFallback.summary?.trim() ?? "",
        }
      : undefined,
    requiredAiProductionProofFiles: request.requiredAiProductionProofFiles,
    mergeOwnershipMaterials: request.mergeOwnershipMaterials,
    requesterPlatform: request.requesterPlatform,
    videoTranscode: request.videoTranscode,
    onStableEpisodeFiles: request.onStableEpisodeFiles,
  };
}

function appVideoTranscodeQueue(concurrency: number) {
  const normalizedConcurrency = Math.max(1, Math.floor(concurrency) || 2);
  let queue = appVideoTranscodeQueues.get(normalizedConcurrency);
  if (!queue) {
    queue = new VideoTranscodeQueue({
      concurrency: normalizedConcurrency,
      onLog: baiduNetdiskLogger("download").callback("download"),
    });
    appVideoTranscodeQueues.set(normalizedConcurrency, queue);
  }
  return queue;
}

function withAppVideoTranscode(
  request: BaiduNetdiskEnsureDownloadedRequest,
): BaiduNetdiskEnsureDownloadedRequest {
  const settings = request.videoTranscode;
  if (!settings) return request;

  const maxFileBytes = Math.max(1, settings.maxFileMegabytes) * 1_000_000;
  const targetFileBytes = Math.max(1, settings.targetFileMegabytes) * 1_000_000;
  if (targetFileBytes >= maxFileBytes) {
    throw new Error("百度应用测试转码目标体积必须小于触发体积。");
  }
  const queue = appVideoTranscodeQueue(settings.concurrency);
  const cacheRootDir = path.join(
    resolveFromAppRoot(settings.runDataDir),
    "media-cache",
    "video-transcodes",
  );
  return {
    ...request,
    onStableEpisodeFiles: (files) => {
      for (const file of files) {
        if (file.size <= maxFileBytes) continue;
        baiduNetdiskLogger("download").info("视频超过大小限制，已加入转码队列", {
          episode: file.index,
          size: file.size,
          maxFileBytes,
        });
        void queue.add({
          inputFile: file.file,
          cacheRootDir,
          policy: {
            maxFileBytes,
            targetFileBytes,
            audioBitrateKbps: 128,
            threadsPerJob: Math.max(1, Math.floor(settings.threadsPerJob) || 2),
          },
          replaceSource: true,
        }).catch((error) => {
          baiduNetdiskLogger("download").error("下载期间视频转码失败", {
            episode: file.index,
            error,
          });
        });
      }
    },
  };
}

function playletDir(root: string, resourceName: string) {
  return path.join(root, resourceName);
}

function cdpPort(config = readConfig()) {
  return Number.parseInt(config.debugPort, 10);
}

async function importBaiduNetdiskRuntimePackage() {
  const runtime = await import("@drama/baidu-netdisk-automation") as {
    configureBaiduNetdiskAutomationLogging: (options: {
      logFilePath: string;
      retentionDays?: number;
    }) => void;
    checkBaiduNetdiskCdpStatus: (options: {
      port: number;
      executablePath?: string;
    }) => Promise<BaiduNetdiskCdpStatus>;
    startBaiduNetdiskCdp: (options: {
      port: number;
      executablePath?: string;
      restart?: boolean;
    }) => Promise<BaiduNetdiskLaunchResult>;
  };
  runtime.configureBaiduNetdiskAutomationLogging({
    logFilePath: baiduNetdiskLogFilePath(),
    retentionDays: 3,
  });
  return runtime;
}

async function importBaiduNetdiskDownloadRuntimePackage() {
  const runtime = await import("@drama/baidu-netdisk-automation/download-baidu-folder") as {
    configureBaiduNetdiskAutomationLogging: (options: {
      logFilePath: string;
      retentionDays?: number;
    }) => void;
    downloadBaiduNetdiskShare: (options: {
      shareText: string;
      resourceName?: string;
      expectedEpisodeCount?: number;
      inferEpisodeCount?: boolean;
      expectedOwnershipCounts?: {
        minimumImages?: number;
      };
      expectedOwnershipFiles?: number;
      expectedPosterImages?: number;
      expectedAiProductionProofFiles?: number;
      downloadEpisodeVideos?: boolean;
      downloadAssetMaterials?: boolean;
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
    controlBaiduNetdiskDownloadTask: (options: {
      port: number;
      targetName: string;
      action: "pause" | "resume" | "delete";
      expectedDownloadRoot?: string;
    }) => Promise<boolean>;
  };
  runtime.configureBaiduNetdiskAutomationLogging({
    logFilePath: baiduNetdiskLogFilePath(),
    retentionDays: 3,
  });
  return runtime;
}

async function status() {
  const config = readConfig();
  const { checkBaiduNetdiskCdpStatus } = await importBaiduNetdiskRuntimePackage();

  return checkBaiduNetdiskCdpStatus({
    port: cdpPort(config),
    executablePath: config.executablePath || undefined,
  });
}

async function controlDownloadTask(targetName: string, action: "pause" | "resume" | "delete") {
  const config = readConfig();
  const runtime = await importBaiduNetdiskDownloadRuntimePackage();
  const result = await runtime.controlBaiduNetdiskDownloadTask({ port: cdpPort(config), targetName, action });
  if (action === "delete") clearDownloadRecords();
  return result;
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
    result = await runBaiduCdpOperationExclusive("手动下载百度网盘分享", () =>
      downloadBaiduNetdiskShare({
        shareText,
        port: cdpPort(config),
        downloadDir: defaultBaiduNetdiskDownloadDir,
      }),
    );
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
  const requestLogger = baiduNetdiskLogger("netdisk", {
    requesterPlatform: normalizedRequest.requesterPlatform,
    resourceName: normalizedRequest.resourceName,
  });
  const shareKey = shareKeyFromText(normalizedRequest.shareText);
  const id = createRecordId(shareKey, normalizedRequest.resourceName);
  const localPath = playletDir(
    normalizedRequest.localEpisodeVideoRoot,
    normalizedRequest.resourceName,
  );
  monitoredEpisodeVideoRoots.add(path.resolve(normalizedRequest.localEpisodeVideoRoot));
  startDiskCleanupMonitor();
  const activeOperation = activeDownloadOperations.get(id);

  if (activeOperation) {
    if (normalizedRequest.onStableEpisodeFiles) {
      activeOperation.stableEpisodeFilesListeners.add(normalizedRequest.onStableEpisodeFiles);
      requestLogger.info("已将素材处理器附加到进行中的下载任务");
    }
    return activeOperation.promise;
  }

  const localPathKey = normalizedPathKey(localPath);
  pendingDownloadPaths.add(localPathKey);
  try {
    await runDiskCleanup([localPath]);
  } finally {
    pendingDownloadPaths.delete(localPathKey);
  }

  const stableEpisodeFilesListeners = new Set<StableEpisodeFilesListener>();
  if (normalizedRequest.onStableEpisodeFiles) {
    stableEpisodeFilesListeners.add(normalizedRequest.onStableEpisodeFiles);
  }
  const requestWithListenerBroadcast: BaiduNetdiskEnsureDownloadedRequest = {
    ...normalizedRequest,
    onStableEpisodeFiles: (files) => {
      if (stableEpisodeFilesListeners.size > 0) {
        requestLogger.info("已通知素材处理器", {
          episodes: files.map((file) => file.index),
        });
      }
      for (const listener of stableEpisodeFilesListeners) {
        try {
          listener(files);
        } catch (error) {
          requestLogger.warn("素材处理器接收稳定剧集失败", { error });
        }
      }
    },
  };
  const promise = ensureBaiduNetdiskShareDownloadedOnce(
    id,
    shareKey,
    requestWithListenerBroadcast,
  ).finally(() => {
    activeDownloadOperations.delete(id);
  });
  activeDownloadOperations.set(id, { promise, stableEpisodeFilesListeners, localPath });

  return promise;
}

async function ensureBaiduNetdiskShareDownloadedOnce(
  id: string,
  shareKey: string,
  request: BaiduNetdiskEnsureDownloadedRequest,
): Promise<BaiduNetdiskDownloadRecord> {
  const uniqueDownloadDir = uniqueBaiduDownloadDir(request.resourceName, shareKey);
  const config = readConfig();
  const timeoutMs = getConfiguredBaiduNetdiskDownloadTimeoutMs();
  const port = cdpPort(config);
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
    downloadDir: uniqueDownloadDir,
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
    const {
      downloadBaiduNetdiskShare,
      getBaiduNetdiskDownloadTaskStatus,
    } = await importBaiduNetdiskDownloadRuntimePackage();
    const runDownload = () => ensureBaiduNetdiskEpisodeVideos({
      shareText: request.shareText,
      resourceName: request.resourceName,
      localEpisodeVideoRoot: request.localEpisodeVideoRoot,
      episodeCount: request.episodeCount,
      downloadEpisodeVideos: request.downloadEpisodeVideos,
      downloadAssetMaterials: request.downloadAssetMaterials,
      inferEpisodeCount: request.inferEpisodeCount,
      forceAssetDownload: request.forceAssetDownload,
      requiredOwnership: request.requiredOwnership,
      requiredOwnershipFiles: request.requiredOwnershipFiles,
      requiredPosterImages: request.requiredPosterImages,
      requiredAiProductionProofFiles: request.requiredAiProductionProofFiles,
      mergeOwnershipMaterials: request.mergeOwnershipMaterials,
      timeoutMs,
      downloadDir: uniqueDownloadDir,
      sourceLocalPath: existingRecord?.localPath,
      downloadTaskName: existingRecord?.resourceName,
      downloadShare: (downloadRequest) =>
        runBaiduCdpOperationExclusive(downloadRequest.resourceName, () =>
          downloadBaiduNetdiskShare({
            shareText: downloadRequest.shareText,
            resourceName: downloadRequest.resourceName,
            expectedEpisodeCount: downloadRequest.expectedEpisodeCount,
            inferEpisodeCount: downloadRequest.inferEpisodeCount,
            expectedOwnershipCounts: downloadRequest.expectedOwnershipCounts,
            expectedOwnershipFiles: downloadRequest.expectedOwnershipFiles,
            expectedPosterImages: downloadRequest.expectedPosterImages,
            expectedAiProductionProofFiles: downloadRequest.expectedAiProductionProofFiles,
            downloadEpisodeVideos: downloadRequest.downloadEpisodeVideos,
            downloadAssetMaterials: downloadRequest.downloadAssetMaterials,
            port,
            downloadDir: downloadRequest.downloadDir,
          }),
        ),
      getDownloadTaskStatus: (statusRequest) =>
        getBaiduNetdiskDownloadTaskStatus({
          port,
          targetName: statusRequest.targetName,
        }),
      onStableEpisodeFiles: request.onStableEpisodeFiles,
      onLog: baiduNetdiskLogger("download", {
        requesterPlatform: request.requesterPlatform,
        resourceName: request.resourceName,
      }).callback("download"),
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
    let result;
    try {
      result = await runDownload();
    } catch (error) {
      const fallbackEnabled = isAiPosterFallbackEnabled();
      const missingPoster = request.requiredPosterImages
        && request.requiredPosterImages > 0
        && isRemoteMaterialValidationError(error, "poster");
      if (!fallbackEnabled || !missingPoster) throw error;

      const summary = request.posterFallback?.summary.trim();
      if (!summary) {
        throw Object.assign(
          new Error(`百度网盘未提供海报，AI 兜底生成需要任务返回剧目简介。原始错误：${readableError(error)}`),
          { cause: error },
        );
      }

      const aiPosterLogger = baiduNetdiskLogger("ai-poster", {
        requesterPlatform: request.requesterPlatform,
        resourceName: request.resourceName,
      });
      aiPosterLogger.warn("百度网盘未提供海报，开始使用 AI 生成", {
        summaryLength: summary.length,
      });
      try {
        const poster = await ensureAiPoster({
          client: createConfiguredAiClient(),
          model: getConfiguredAiImageModel(),
          localMaterialRoot: request.localEpisodeVideoRoot,
          resourceName: request.resourceName,
          title: request.posterFallback?.title || request.resourceName,
          summary,
          onLog: aiPosterLogger.callback("ai-poster"),
        });
        aiPosterLogger.info("AI 海报准备完成，重新校验百度网盘资源", {
          file: poster.file,
          height: poster.height,
          reused: poster.reused,
          size: poster.size,
          width: poster.width,
        });
      } catch (generationError) {
        throw Object.assign(
          new Error(`百度网盘未提供海报，AI 兜底生成失败：${readableError(generationError)}`),
          { cause: generationError },
        );
      }
      result = await runDownload();
    }

    const completedLocalPath = result.localPath || localPath;
    const completedAt = new Date();
    await utimes(completedLocalPath, completedAt, completedAt).catch((error) => {
      baiduNetdiskLogger("storage").warn("无法刷新剧目目录保留时间", {
        path: completedLocalPath,
        error,
      });
    });

    return upsertDownloadRecord({
      ...record,
      resourceName: request.resourceName,
      episodeCount: result.episodeCount,
      localPath: completedLocalPath,
      progressPercent: 100,
      state: "completed",
      skippedExisting: result.skippedExisting,
      error: undefined,
      completedAt: completedAt.toISOString(),
    });
  } catch (error) {
    const message = readableError(error);
    upsertDownloadRecord({
      ...record,
      state: "failed",
      error: message,
    });
    throw Object.assign(new Error(message), { cause: error });
  } finally {
    void cleanupBaiduNetdiskDownloadArtifacts({
      downloadDir: uniqueDownloadDir,
      targetName: request.resourceName,
      port,
    }).catch((error) => {
      baiduNetdiskLogger("storage", {
        requesterPlatform: request.requesterPlatform,
        resourceName: request.resourceName,
      }).warn("清理下载临时资源失败", { error });
    });
  }
}

function isRemoteMaterialValidationError(
  error: unknown,
  material: "episode" | "ownership-images" | "ownership-files" | "poster" | "ai-production-proof",
) {
  return Boolean(
    error
    && typeof error === "object"
    && "_tag" in error
    && error._tag === "RemoteMaterialValidationError"
    && "material" in error
    && error.material === material,
  );
}

function readableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalizedMessage = message.replace(/^(Error:\s*)+/g, "");
  const transferJsonMatch = normalizedMessage.match(/保存分享到网盘失败：(\{.*\})/);
  const ownListJsonMatch = normalizedMessage.match(/读取我的网盘目录失败：([^；]+)；(?:.*?；)?(\{.*\})/);

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

  if (ownListJsonMatch) {
    try {
      const dir = ownListJsonMatch[1];
      const data = JSON.parse(ownListJsonMatch[2]) as {
        errno?: number;
        errmsg?: string;
        show_msg?: string;
        message?: string;
        request_id?: string | number;
      };
      const apiMessage = data.show_msg || data.errmsg || data.message || "";
      if (data.errno === -6 || apiMessage.includes("账户已过期") || apiMessage.includes("重新登陆")) {
        return "百度网盘账号登录已过期，请在百度网盘客户端重新登录后再下载。";
      }
      if (data.errno === 1 || data.errno === 4) {
        return `读取我的网盘目录失败：${dir}；百度接口临时异常或登录态不可用，请确认客户端已登录并重启为 CDP 模式后重试；errno=${data.errno}${
          data.request_id ? `；request_id=${data.request_id}` : ""
        }`;
      }
      return `读取我的网盘目录失败：${dir}；${apiMessage || "百度接口返回异常"}；errno=${data.errno ?? "-"}${
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

export function registerBaiduNetdiskPlatformHandlers() {
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
  ipcMain.handle("baidu-netdisk:downloads:control", (_event, request: { targetName: string; action: "pause" | "resume" | "delete" }) =>
    controlDownloadTask(request.targetName, request.action),
  );
  ipcMain.handle("baidu-netdisk:share:download", (_event, request) =>
    downloadShare(request as BaiduNetdiskShareDownloadRequest | undefined),
  );
  ipcMain.handle("baidu-netdisk:share:ensure-downloaded", (_event, request) =>
    ensureBaiduNetdiskShareDownloaded(
      withAppVideoTranscode(request as BaiduNetdiskEnsureDownloadedRequest),
    ),
  );
}
