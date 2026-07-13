import { BrowserWindow, ipcMain } from "electron";
import Store from "electron-store";
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

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

type PlatformId = "wechat-drama" | "meituan-drama" | "kuaishou-drama" | "tiktok-drama";

type RegisterBaiduNetdiskPlatformHandlersOptions = {
  openWindow?: (platformId: PlatformId) => void;
};

const defaultBaiduNetdiskConfig: BaiduNetdiskConfig = {
  debugPort: "9337",
  executablePath: "",
};

const defaultBaiduNetdiskDownloadDir = "D:\\BaiduNetdiskDownload";

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

function localEpisodeFilePatterns(resourceName: string) {
  const escapedResourceName = escapeRegExp(resourceName);
  return [
    new RegExp(`^${escapedResourceName}(?:\\s*-\\s*|\\s*)第(\\d+)集\\.mp4$`, "i"),
    new RegExp(`^${escapedResourceName}(?:\\s*-\\s*|\\s*)(\\d+)\\s*集?\\.mp4$`, "i"),
    /^第(\d+)集\.mp4$/i,
    /^(?:ep|episode|e)[\s._-]*(\d+)\.mp4$/i,
    /^(\d+)\.mp4$/i,
  ];
}

function localEpisodeScanDirs(root: string, resourceName: string) {
  const directory = playletDir(root, resourceName);
  return [
    directory,
    path.join(directory, "成片"),
    path.join(directory, "成品"),
    path.join(directory, "视频"),
    path.join(directory, "正片"),
  ];
}

function matchLocalEpisodeIndex(fileName: string, resourceName: string) {
  const match = localEpisodeFilePatterns(resourceName)
    .map((pattern) => pattern.exec(fileName))
    .find((result): result is RegExpExecArray => result !== null);

  if (match) return Number(match[1]);

  const stem = fileName.replace(/\.[^.]+$/, "");
  const trailingNumberMatch = stem.match(/(\d{1,4})\s*(?:集|episode|ep|e)?\s*$/i);
  if (!trailingNumberMatch) return undefined;

  const index = Number(trailingNumberMatch[1]);
  return Number.isInteger(index) && index > 0 ? index : undefined;
}

async function logLocalEpisodeDirectoryDetails(
  root: string,
  resourceName: string,
  episodeCount: number,
  reason: string,
  options: { recursive?: boolean } = {},
) {
  console.log(
    `[baidu] 本地剧集目录扫描：reason=${reason} root=${root} resource=${resourceName} expected=${episodeCount}`,
  );

  const scanDirs = options.recursive
    ? await recursiveLocalEpisodeScanDirs(root, resourceName)
    : localEpisodeScanDirs(root, resourceName);
  const summaries: Array<{
    dir: string;
    fileCount: number;
    directoryCount: number;
    matchedMp4: string[];
    unmatchedMp4: string[];
  }> = [];

  for (const scanDir of scanDirs) {
    const entries = await readdir(scanDir, { withFileTypes: true }).catch(() => undefined);
    if (!entries) continue;

    const matchedMp4: string[] = [];
    const unmatchedMp4: string[] = [];
    let fileCount = 0;
    let directoryCount = 0;

    for (const entry of entries) {
      const entryPath = path.join(scanDir, entry.name);
      if (entry.isDirectory()) {
        directoryCount += 1;
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      fileCount += 1;
      const fileStat = await stat(entryPath).catch(() => undefined);
      const size = fileStat?.isFile() ? fileStat.size : undefined;

      if (!entry.name.toLowerCase().endsWith(".mp4")) continue;

      const episodeIndex = matchLocalEpisodeIndex(entry.name, resourceName);
      if (episodeIndex === undefined) {
        unmatchedMp4.push(entry.name);
      } else {
        matchedMp4.push(`${episodeIndex}:${entry.name}${size === undefined ? "" : ` size=${size}`}`);
      }
    }

    if (fileCount > 0 || directoryCount > 0 || matchedMp4.length > 0 || unmatchedMp4.length > 0) {
      summaries.push({ dir: scanDir, fileCount, directoryCount, matchedMp4, unmatchedMp4 });
    }
  }

  const logged = summaries
    .sort((left, right) => right.matchedMp4.length - left.matchedMp4.length || left.dir.localeCompare(right.dir))
    .slice(0, 8);
  if (logged.length <= 0) {
    const standardDir = playletDir(root, resourceName);
    console.log(
      options.recursive
        ? `[baidu] 本地目录详情：${root} 未发现可读取目录或文件`
        : `[baidu] 本地标准目录未发现完整文件：${standardDir}`,
    );
    return;
  }

  for (const summary of logged) {
    const sample = summary.matchedMp4.slice(0, 5).join(" | ") || "无";
    const unmatched = summary.unmatchedMp4.length > 0 ? ` unmatched=${summary.unmatchedMp4.length}` : "";
    console.log(
      `[baidu] 本地目录：${summary.dir} 文件=${summary.fileCount} 目录=${summary.directoryCount}` +
        ` matched=${summary.matchedMp4.length}/${episodeCount} 示例=${sample}${unmatched}`,
    );
  }
}

type LocalEpisodeFile = { index: number; file: string; size: number };

async function listDirectLocalEpisodeFiles(scanDir: string, resourceName: string): Promise<LocalEpisodeFile[]> {
  const files: LocalEpisodeFile[] = [];
  const entries = await readdir(scanDir, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".mp4")) continue;

    const index = matchLocalEpisodeIndex(entry.name, resourceName);
    if (index === undefined) continue;

    const file = path.join(scanDir, entry.name);
    const fileStat = await stat(file).catch(() => undefined);
    if (!fileStat?.isFile() || fileStat.size <= 0) continue;

    files.push({ index, file, size: fileStat.size });
  }

  return files.sort((left, right) => left.index - right.index);
}

async function recursiveLocalEpisodeScanDirs(root: string, resourceName: string) {
  const dirs = [...localEpisodeScanDirs(root, resourceName)];
  const seen = new Set(dirs.map((dir) => path.resolve(dir).toLowerCase()));
  const queue = [{ dir: root, depth: 0 }];
  const maxDepth = 5;
  const maxDirs = 200;

  while (queue.length > 0 && dirs.length < maxDirs) {
    const current = queue.shift();
    if (!current) continue;
    const resolved = path.resolve(current.dir).toLowerCase();
    if (!seen.has(resolved)) {
      seen.add(resolved);
      dirs.push(current.dir);
    }
    if (current.depth >= maxDepth) continue;

    const entries = await readdir(current.dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
    }
  }

  return dirs;
}

async function listLocalEpisodeFiles(root: string, resourceName: string, allowArbitraryDir = false) {
  const scanDirs = allowArbitraryDir
    ? await recursiveLocalEpisodeScanDirs(root, resourceName)
    : localEpisodeScanDirs(root, resourceName);
  const candidates: Array<{ dir: string; files: LocalEpisodeFile[] }> = [];

  for (const scanDir of scanDirs) {
    const files = await listDirectLocalEpisodeFiles(scanDir, resourceName);
    candidates.push({ dir: scanDir, files });
  }

  const best = candidates.sort((left, right) =>
    right.files.length - left.files.length ||
    left.dir.localeCompare(right.dir),
  )[0];
  return (best?.files ?? []).sort((left, right) => left.index - right.index);
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

function episodeFileSummary(files: LocalEpisodeFile[]) {
  const indexes = [...new Set(files.map((file) => file.index))].sort((left, right) => left - right);

  return {
    count: indexes.length,
    min: indexes[0],
    max: indexes[indexes.length - 1],
  };
}

function localEpisodeSourceDir(files: LocalEpisodeFile[]) {
  const dirs = [...new Set(files.map((file) => path.dirname(file.file)))];
  return dirs.length === 1 ? dirs[0] : undefined;
}

function samePath(left: string, right: string) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function standardEpisodeFileName(resourceName: string, index: number) {
  return `${resourceName} - 第${index}集.mp4`;
}

async function moveOrCopyFile(sourceFile: string, targetFile: string) {
  await rm(targetFile, { force: true });
  try {
    await rename(sourceFile, targetFile);
    return "move" as const;
  } catch {
    await copyFile(sourceFile, targetFile);
    return "copy" as const;
  }
}

async function standardizeDownloadedEpisodeFilesToWechatRoot(
  files: LocalEpisodeFile[],
  targetRoot: string,
  resourceName: string,
) {
  const targetDir = playletDir(targetRoot, resourceName);
  const sourceDir = localEpisodeSourceDir(files);
  const sourceLabel = sourceDir ?? "多个目录";
  let workingFiles = [...files]
    .sort((left, right) => left.index - right.index || left.file.localeCompare(right.file));
  let directoryRenamed = false;
  let targetExists = await pathExists(targetDir);

  console.log(`[baidu] 下载完成，标准化剧集目录和文件名：${sourceLabel} -> ${targetDir}`);

  if (sourceDir) {
    const sourceResolved = path.resolve(sourceDir);
    const targetResolved = path.resolve(targetDir);
    if (sourceResolved.toLowerCase() !== targetResolved.toLowerCase() && !targetExists) {
      await mkdir(path.dirname(targetDir), { recursive: true });
      try {
        await rename(sourceDir, targetDir);
        directoryRenamed = true;
        targetExists = true;
        workingFiles = workingFiles.map((file) => ({
          ...file,
          file: path.join(targetDir, path.basename(file.file)),
        }));
      } catch (error) {
        console.log(
          `[baidu] 标准化目录重命名失败，回退逐文件移动：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  if (!targetExists) {
    await mkdir(targetDir, { recursive: true });
  }

  const standardPaths = new Set<string>();
  let movedCount = 0;
  let copiedCount = 0;

  for (const file of workingFiles) {
    const targetFile = path.join(targetDir, standardEpisodeFileName(resourceName, file.index));
    standardPaths.add(path.resolve(targetFile).toLowerCase());

    if (path.resolve(file.file).toLowerCase() === path.resolve(targetFile).toLowerCase()) continue;
    const operation = await moveOrCopyFile(file.file, targetFile);
    if (operation === "move") movedCount += 1;
    else copiedCount += 1;
  }

  console.log(
    `[baidu] 标准化剧集完成：目录重命名=${directoryRenamed ? "是" : "否"} 移动=${movedCount} 复制=${copiedCount}`,
  );

  const existingEntries = await readdir(targetDir, { withFileTypes: true }).catch(() => []);
  for (const entry of existingEntries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".mp4")) continue;

    const entryPath = path.join(targetDir, entry.name);
    if (standardPaths.has(path.resolve(entryPath).toLowerCase())) continue;
    await rm(entryPath, { force: true });
  }

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

function currentDownloadLocalPaths(paths: Array<string | undefined>, targetRoot: string, resourceName: string) {
  const standardTargetDir = playletDir(targetRoot, resourceName);
  const normalized = paths
    .filter((item): item is string => Boolean(item?.trim()))
    .map((item) => path.resolve(item));
  const nonStandard = normalized.filter((item) => !samePath(item, standardTargetDir));
  const candidates = nonStandard.length > 0 ? nonStandard : normalized;

  return [...new Map(candidates.map((item) => [item.toLowerCase(), item])).values()];
}

async function localEpisodeCandidateDirs(localPath: string) {
  const localStat = await stat(localPath).catch(() => undefined);
  const baseDir = localStat?.isFile() ? path.dirname(localPath) : localPath;
  return [
    baseDir,
    path.join(baseDir, "成片"),
    path.join(baseDir, "成品"),
    path.join(baseDir, "视频"),
    path.join(baseDir, "正片"),
  ];
}

async function listCurrentDownloadEpisodeFiles(
  localPaths: string[],
  targetRoot: string,
  resourceName: string,
) {
  const candidates: Array<{ label: string; files: LocalEpisodeFile[] }> = [];
  const seenDirs = new Set<string>();

  for (const localPath of localPaths) {
    for (const dir of await localEpisodeCandidateDirs(localPath)) {
      const key = path.resolve(dir).toLowerCase();
      if (seenDirs.has(key)) continue;
      seenDirs.add(key);
      candidates.push({ label: dir, files: await listDirectLocalEpisodeFiles(dir, resourceName) });
    }
  }

  if (candidates.length <= 0) {
    candidates.push({
      label: playletDir(targetRoot, resourceName),
      files: await listLocalEpisodeFiles(targetRoot, resourceName),
    });
  }

  return candidates
    .sort((left, right) => right.files.length - left.files.length || left.label.localeCompare(right.label))[0]
    ?.files ?? [];
}

async function waitForCompleteLocalEpisodeVideos(options: {
  id: string;
  record: BaiduNetdiskDownloadRecord;
  targetRoot: string;
  resourceName: string;
  downloadTaskName?: string;
  episodeCount: number;
  sourceLocalPath?: string;
  port?: number;
  timeoutMs?: number;
}) {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 12 * 60 * 60 * 1000;
  const stableSignatures = new Map<string, { signature: string; count: number }>();
  let lastProgressLogAt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    let record = readDownloadRecords().find((item) => item.id === options.id) ?? options.record;
    let localPaths = currentDownloadLocalPaths(
      [options.sourceLocalPath, record.localPath],
      options.targetRoot,
      options.resourceName,
    );
    let bestLocalSummary: ReturnType<typeof episodeFileSummary> | undefined;
    let files = await listCurrentDownloadEpisodeFiles(localPaths, options.targetRoot, options.resourceName);
    bestLocalSummary = episodeFileSummary(files);
    let complete = isCompleteEpisodeFileSet(files, options.episodeCount);
    let signature = fileSetSignature(files);
    let stableKey = localPaths.join("|") || playletDir(options.targetRoot, options.resourceName);
    let stable = stableSignatures.get(stableKey);
    let nextStable = {
      signature,
      count: complete && stable?.signature === signature ? stable.count + 1 : complete ? 1 : 0,
    };
    stableSignatures.set(stableKey, nextStable);

    if (complete && nextStable.count >= 2) {
      await standardizeDownloadedEpisodeFilesToWechatRoot(files, options.targetRoot, options.resourceName);

      return playletDir(options.targetRoot, options.resourceName);
    }

    if (options.port) {
      const { getBaiduNetdiskDownloadTaskStatus } = await importBaiduNetdiskDownloadRuntimePackage();
      const taskStatus = await getBaiduNetdiskDownloadTaskStatus({
        port: options.port,
        targetName: options.downloadTaskName || options.resourceName,
      }).catch(() => undefined);

      if (taskStatus) {
        localPaths = currentDownloadLocalPaths(
          [options.sourceLocalPath, record.localPath, taskStatus.localPath],
          options.targetRoot,
          options.resourceName,
        );
        files = await listCurrentDownloadEpisodeFiles(localPaths, options.targetRoot, options.resourceName);
        bestLocalSummary = episodeFileSummary(files);
        complete = isCompleteEpisodeFileSet(files, options.episodeCount);
        signature = fileSetSignature(files);
        stableKey = localPaths.join("|") || playletDir(options.targetRoot, options.resourceName);
        stable = stableSignatures.get(stableKey);
        nextStable = {
          signature,
          count: complete && stable?.signature === signature ? stable.count + 1 : complete ? 1 : 0,
        };
        stableSignatures.set(stableKey, nextStable);

        const transferredBytes = taskStatus.finishSize ?? 0;
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
          console.log(
            `[baidu] 下载状态：${options.resourceName}` +
              (bestLocalSummary
                ? ` 本地识别=${bestLocalSummary.count}/${options.episodeCount}集` +
                  (bestLocalSummary.min !== undefined ? `(${bestLocalSummary.min}-${bestLocalSummary.max})` : "")
                : "") +
              (taskStatus.rate ? ` ${taskStatus.rate}` : "") +
              (taskStatus.status ? ` status=${taskStatus.status}` : ""),
          );
          lastProgressLogAt = Date.now();
        }

        if ((complete && nextStable.count >= 2) || (taskStatus.completed && complete)) {
          await standardizeDownloadedEpisodeFilesToWechatRoot(files, options.targetRoot, options.resourceName);

          return playletDir(options.targetRoot, options.resourceName);
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  for (const root of [
    options.targetRoot,
    options.sourceLocalPath,
    options.record.localPath,
  ].filter((item): item is string => Boolean(item?.trim()))) {
    await logLocalEpisodeDirectoryDetails(
      root,
      options.resourceName,
      options.episodeCount,
      "等待下载完成超时",
    );
  }

  throw new Error(`等待百度网盘资源下载完成超时：${playletDir(options.targetRoot, options.resourceName)}`);
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
    const message = readableError(error);
    record = upsertDownloadRecord({
      ...record,
      state: "failed",
      error: message,
    });
    throw new Error(message);
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

  const hasExistingCompleteVideos = await hasCompleteLocalEpisodeVideos(
    request.localEpisodeVideoRoot,
    request.resourceName,
    request.episodeCount,
  );

  if (hasExistingCompleteVideos) {
    return upsertDownloadRecord({
      ...record,
      state: "completed",
      skippedExisting: true,
      error: undefined,
      completedAt: new Date().toISOString(),
    });
  }

  await logLocalEpisodeDirectoryDetails(
    request.localEpisodeVideoRoot,
    request.resourceName,
    request.episodeCount,
    "启动前未发现完整文件",
  );

  if (existingRecord?.state === "downloading") {
    const config = readConfig();
    const existingTaskName = existingRecord.resourceName || request.resourceName;
    const { getBaiduNetdiskDownloadTaskStatus } = await importBaiduNetdiskDownloadRuntimePackage();
    const existingTaskStatus = await getBaiduNetdiskDownloadTaskStatus({
      port: cdpPort(config),
      targetName: existingTaskName,
    }).catch(() => undefined);

    if (!existingTaskStatus?.found) {
      console.log(`[baidu] 下载记录为进行中，但客户端未找到任务，重新提交下载：${existingTaskName}`);
    } else {
      console.log(
        `[baidu] 发现已有客户端下载任务，继续等待：${existingTaskName}` +
          (existingTaskStatus.status ? ` status=${existingTaskStatus.status}` : "") +
          (existingTaskStatus.rate ? ` ${existingTaskStatus.rate}` : ""),
      );

      try {
        const completedPath = await waitForCompleteLocalEpisodeVideos({
          id,
          record,
          targetRoot: request.localEpisodeVideoRoot,
          sourceLocalPath: existingRecord.localPath,
          resourceName: request.resourceName,
          downloadTaskName: existingRecord.resourceName,
          episodeCount: request.episodeCount,
          port: cdpPort(config),
        });

        return upsertDownloadRecord({
          ...record,
          localPath: completedPath,
          state: "completed",
          error: undefined,
          completedAt: new Date().toISOString(),
        });
      } catch (error) {
        const message = readableError(error);
        record = upsertDownloadRecord({
          ...record,
          state: "failed",
          error: message,
        });
        throw new Error(message);
      }
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
      resourceName: request.resourceName,
      downloadDir: result.downloadRoot ?? request.localEpisodeVideoRoot,
      localPath: result.localPath ?? record.localPath,
      error: undefined,
    });
    const completedPath = await waitForCompleteLocalEpisodeVideos({
      id,
      record,
      targetRoot: request.localEpisodeVideoRoot,
      sourceLocalPath: result.localPath,
      resourceName: request.resourceName,
      downloadTaskName: result.share.name || request.resourceName,
      episodeCount: request.episodeCount,
      port: cdpPort(config),
    });

    return upsertDownloadRecord({
      ...record,
      resourceName: request.resourceName,
      downloadDir: result.downloadRoot ?? request.localEpisodeVideoRoot,
      localPath: completedPath,
      progressPercent: 100,
      state: "completed",
      skippedExisting: result.skippedExisting,
      error: undefined,
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = readableError(error);
    record = upsertDownloadRecord({
      ...record,
      state: "failed",
      error: message,
    });
    throw new Error(message);
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

      if (data.errno === -6 || apiMessage.includes("账户已过期") || apiMessage.includes("重新登陆")) {
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

export function registerBaiduNetdiskPlatformHandlers(
  options: RegisterBaiduNetdiskPlatformHandlersOptions = {},
) {
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
  ipcMain.handle("baidu-netdisk:share:ensure-downloaded", (_event, request) =>
    ensureBaiduNetdiskShareDownloaded(request as BaiduNetdiskEnsureDownloadedRequest),
  );
  ipcMain.handle("baidu-netdisk:window:open", (_event, platformId: PlatformId) => {
    options.openWindow?.(platformId);
    return true;
  });
}
