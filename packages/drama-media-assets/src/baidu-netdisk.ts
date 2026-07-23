import path from "node:path";
import {
  collectEpisodeDirectorySummaries,
  composeOwnershipMaterialsIntoTwo,
  episodeFileSummary,
  fileSetSignature,
  hasRequiredOwnershipMaterials,
  isCompleteEpisodeFileSet,
  listDirectLocalEpisodeFiles,
  listLocalEpisodeFiles,
  listLocalOwnershipMaterials,
  listLocalPosterImages,
  playletDir,
  standardizeEpisodeFilesToRoot,
  standardizeOwnershipMaterialsToRoot,
  standardizePosterImagesToRoot,
  type LocalEpisodeFile,
  type LocalOwnershipMaterialSet,
  type LocalPosterImageFile,
  type OwnershipMaterialRequirements,
} from "./index.js";

export type BaiduNetdiskShareInfo = {
  link: string;
  pwd: string;
  name: string;
};

export type BaiduNetdiskShareDownloadResult = {
  share: BaiduNetdiskShareInfo;
  downloadRoot?: string;
  localPath?: string;
  expectedOwnershipImages?: number;
  expectedPosterImages?: number;
  completed: boolean;
  skippedExisting: boolean;
};

export type BaiduNetdiskDownloadTaskStatus = {
  found: boolean;
  name?: string;
  localPath?: string;
  status?: string;
  size?: number;
  finishSize?: number;
  rate?: string;
  completed: boolean;
  tasks: string[];
};

export type BaiduNetdiskEpisodeVideoProgress = {
  phase: "existing-complete" | "download-submitted" | "downloading" | "standardized" | "scan";
  localPath?: string;
  downloadRoot?: string;
  nativeStatus?: string;
  speedText?: string;
  progressPercent?: number;
  transferredBytes?: number;
  totalBytes?: number;
  skippedExisting?: boolean;
};

export type EnsureBaiduNetdiskEpisodeVideosOptions = {
  shareText: string;
  resourceName: string;
  localEpisodeVideoRoot: string;
  episodeCount: number;
  requiredOwnership?: OwnershipMaterialRequirements;
  requiredPosterImages?: number;
  mergeOwnershipMaterials?: boolean;
  downloadDir?: string;
  downloadTaskName?: string;
  sourceLocalPath?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  stableCompletePolls?: number;
  downloadShare: (request: {
    shareText: string;
    resourceName: string;
    expectedEpisodeCount?: number;
    expectedOwnershipCounts?: OwnershipMaterialRequirements;
    expectedPosterImages?: number;
    downloadDir: string;
  }) => Promise<BaiduNetdiskShareDownloadResult>;
  getDownloadTaskStatus?: (request: {
    targetName: string;
  }) => Promise<BaiduNetdiskDownloadTaskStatus | undefined>;
  onProgress?: (progress: BaiduNetdiskEpisodeVideoProgress) => void | Promise<void>;
  onLog?: (message: string) => void;
};

export type EnsureBaiduNetdiskEpisodeVideosResult = {
  localPath: string;
  skippedExisting: boolean;
  completed: boolean;
};

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
      totalBytes:
        Number.isFinite(totalBytes) && totalBytes && totalBytes > 0 ? totalBytes : undefined,
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

function samePath(left: string, right: string) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function currentDownloadLocalPaths(
  paths: Array<string | undefined>,
  targetRoot: string,
  resourceName: string,
) {
  const standardTargetDir = playletDir(targetRoot, resourceName);
  const normalized = paths
    .filter((item): item is string => Boolean(item?.trim()))
    .map((item) => path.resolve(item));
  const nonStandard = normalized.filter((item) => !samePath(item, standardTargetDir));
  const candidates = nonStandard.length > 0 ? nonStandard : normalized;

  return [...new Map(candidates.map((item) => [item.toLowerCase(), item])).values()];
}

async function localEpisodeCandidateDirs(localPath: string) {
  const baseDir = localPath;
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
    candidates.push({
      label: `${localPath} (recursive)`,
      files: await listLocalEpisodeFiles({
        root: localPath,
        resourceName,
        allowArbitraryDir: true,
      }),
    });
  }

  if (candidates.length <= 0) {
    candidates.push({
      label: playletDir(targetRoot, resourceName),
      files: await listLocalEpisodeFiles({ root: targetRoot, resourceName }),
    });
  }

  return (
    candidates.sort(
      (left, right) =>
        right.files.length - left.files.length || left.label.localeCompare(right.label),
    )[0]?.files ?? []
  );
}

async function listCurrentOwnershipMaterials(
  localPaths: string[],
  targetRoot: string,
  resourceName: string,
): Promise<LocalOwnershipMaterialSet> {
  const downloaded: LocalOwnershipMaterialSet = [];
  const seen = new Set<string>();

  for (const localPath of localPaths) {
    const key = path.resolve(localPath).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const materials = await listLocalOwnershipMaterials({
      root: localPath,
      resourceName,
      rootIsResourceDir: true,
    });
    downloaded.push(...materials);
  }

  // Once a downloaded ownership directory is present, treat that complete directory as
  // authoritative. Mixing previously standardized copies back in would duplicate images.
  const standardOwnershipDir = path.join(playletDir(targetRoot, resourceName), "权属文件");
  const externalDownloaded = downloaded.filter((file) => {
    const relative = path.relative(standardOwnershipDir, file.file);
    return relative.startsWith("..") || path.isAbsolute(relative);
  });
  const combined = externalDownloaded.length > 0
    ? externalDownloaded
    : downloaded.length > 0
      ? downloaded
    : await listLocalOwnershipMaterials({ root: targetRoot, resourceName });
  return [...new Map(
    combined.map((file) => [path.resolve(file.file).toLowerCase(), file]),
  ).values()];
}

async function listCurrentPosterImages(
  localPaths: string[],
  targetRoot: string,
  resourceName: string,
): Promise<LocalPosterImageFile[]> {
  const downloaded: LocalPosterImageFile[] = [];
  const seen = new Set<string>();
  for (const localPath of localPaths) {
    const key = path.resolve(localPath).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    downloaded.push(...await listLocalPosterImages({
      root: localPath,
      resourceName,
      rootIsResourceDir: true,
    }));
  }

  const standardPosterDir = path.join(playletDir(targetRoot, resourceName), "海报封面");
  const externalDownloaded = downloaded.filter((file) => {
    const relative = path.relative(standardPosterDir, file.file);
    return relative.startsWith("..") || path.isAbsolute(relative);
  });
  return externalDownloaded.length > 0
    ? externalDownloaded
    : downloaded.length > 0
      ? downloaded
      : listLocalPosterImages({ root: targetRoot, resourceName });
}

function ownershipSignature(materials: LocalOwnershipMaterialSet) {
  return materials
    .map((file) => `${file.file}:${file.size}`)
    .join("|");
}

function posterSignature(files: LocalPosterImageFile[]) {
  return files.map((file) => `${file.file}:${file.size}`).join("|");
}

async function standardizeCompleteResources(options: {
  files: LocalEpisodeFile[];
  ownership: LocalOwnershipMaterialSet;
  posters: LocalPosterImageFile[];
  ownershipRequirements: OwnershipMaterialRequirements;
  targetRoot: string;
  resourceName: string;
  onLog?: (message: string) => void;
}) {
  await standardizeOwnershipMaterialsToRoot({
    materials: options.ownership,
    requirements: options.ownershipRequirements,
    targetRoot: options.targetRoot,
    resourceName: options.resourceName,
    onLog: options.onLog,
  });
  await standardizePosterImagesToRoot({
    files: options.posters,
    targetRoot: options.targetRoot,
    resourceName: options.resourceName,
    onLog: options.onLog,
  });
  return standardizeEpisodeFilesToRoot({
    files: options.files,
    targetRoot: options.targetRoot,
    resourceName: options.resourceName,
    onLog: options.onLog,
  });
}

async function composeStandardizedOwnershipMaterials(options: {
  targetRoot: string;
  resourceName: string;
  requirements: OwnershipMaterialRequirements;
}) {
  const materials = await listLocalOwnershipMaterials({ root: options.targetRoot, resourceName: options.resourceName });
  const selected = materials;
  if (selected.length === 0) return undefined;
  const output = await composeOwnershipMaterialsIntoTwo({
    files: selected,
    outputDir: path.join(playletDir(options.targetRoot, options.resourceName), "权属文件"),
    resourceName: options.resourceName,
  });
  return output;
}

async function logEpisodeDirectoryDetails(options: {
  root: string;
  resourceName: string;
  episodeCount: number;
  reason: string;
  recursive?: boolean;
  onLog?: (message: string) => void;
}) {
  options.onLog?.(
    `[video-assets] 本地剧集目录扫描：reason=${options.reason} root=${options.root} resource=${options.resourceName} expected=${options.episodeCount}`,
  );
  const summaries = await collectEpisodeDirectorySummaries({
    root: options.root,
    resourceName: options.resourceName,
    recursive: options.recursive,
  });
  const logged = summaries.slice(0, 8);

  if (logged.length <= 0) {
    options.onLog?.(
      options.recursive
        ? `[video-assets] 本地目录详情：${options.root} 未发现可读取目录或文件`
        : `[video-assets] 本地标准目录未发现完整文件：${playletDir(options.root, options.resourceName)}`,
    );
    return;
  }

  for (const summary of logged) {
    const sample = summary.matchedMp4.slice(0, 5).join(" | ") || "无";
    const unmatched =
      summary.unmatchedMp4.length > 0 ? ` unmatched=${summary.unmatchedMp4.length}` : "";
    options.onLog?.(
      `[video-assets] 本地目录：${summary.dir} 文件=${summary.fileCount} 目录=${summary.directoryCount}` +
      ` matched=${summary.matchedMp4.length}/${options.episodeCount} 示例=${sample}${unmatched}`,
    );
  }
}

async function waitForCompleteLocalEpisodeVideos(options: {
  targetRoot: string;
  resourceName: string;
  episodeCount: number;
  ownershipRequirements: OwnershipMaterialRequirements;
  requiredPosterImages: number;
  mergeOwnershipMaterials?: boolean;
  sourceLocalPath?: string;
  downloadTaskName?: string;
  expectedOwnershipImages?: number;
  expectedPosterImages?: number;
  timeoutMs: number;
  pollIntervalMs: number;
  stableCompletePolls: number;
  getDownloadTaskStatus?: EnsureBaiduNetdiskEpisodeVideosOptions["getDownloadTaskStatus"];
  onProgress?: EnsureBaiduNetdiskEpisodeVideosOptions["onProgress"];
  onLog?: EnsureBaiduNetdiskEpisodeVideosOptions["onLog"];
}) {
  const startedAt = Date.now();
  const stableSignatures = new Map<string, { signature: string; count: number }>();
  let lastProgressLogAt = 0;

  while (Date.now() - startedAt < options.timeoutMs) {
    let localPaths = currentDownloadLocalPaths(
      [options.sourceLocalPath],
      options.targetRoot,
      options.resourceName,
    );
    let files = await listCurrentDownloadEpisodeFiles(
      localPaths,
      options.targetRoot,
      options.resourceName,
    );
    let complete = isCompleteEpisodeFileSet(files, options.episodeCount);
    let ownership = await listCurrentOwnershipMaterials(
      localPaths,
      options.targetRoot,
      options.resourceName,
    );
    let ownershipComplete = hasRequiredOwnershipMaterials(ownership, options.ownershipRequirements);
    let posters = await listCurrentPosterImages(localPaths, options.targetRoot, options.resourceName);
    let postersComplete = posters.length >= options.requiredPosterImages;
    let signature = `${fileSetSignature(files)}#${ownershipSignature(ownership)}#${posterSignature(posters)}`;
    let stableKey = localPaths.join("|") || playletDir(options.targetRoot, options.resourceName);
    let stable = stableSignatures.get(stableKey);
    let nextStable = {
      signature,
      count: complete && ownershipComplete && postersComplete && stable?.signature === signature
        ? stable.count + 1
        : complete && ownershipComplete && postersComplete ? 1 : 0,
    };
    stableSignatures.set(stableKey, nextStable);

    const expectedOwnershipImages = Math.max(
      options.ownershipRequirements.minimumImages ?? 0,
      options.expectedOwnershipImages ?? 0,
    );
    const expectedPosterImages = Math.max(
      options.requiredPosterImages,
      options.expectedPosterImages ?? 0,
    );
    const ownershipDirectoryComplete = ownership.length >= expectedOwnershipImages;
    const posterDownloadComplete = posters.length >= expectedPosterImages;
    if (complete && ownershipComplete && ownershipDirectoryComplete && postersComplete && posterDownloadComplete && nextStable.count >= options.stableCompletePolls) {
      const completedPath = await standardizeCompleteResources({
        files,
        ownership,
        posters,
        ownershipRequirements: options.ownershipRequirements,
        targetRoot: options.targetRoot,
        resourceName: options.resourceName,
        onLog: options.onLog,
      });
      if (options.mergeOwnershipMaterials) {
        await composeStandardizedOwnershipMaterials({ targetRoot: options.targetRoot, resourceName: options.resourceName, requirements: options.ownershipRequirements });
      }
      return completedPath;
    }

    if (options.getDownloadTaskStatus) {
      const taskStatus = await options.getDownloadTaskStatus({
        targetName: options.downloadTaskName || options.resourceName,
      }).catch(() => undefined);

      if (taskStatus) {
        localPaths = currentDownloadLocalPaths(
          [options.sourceLocalPath, taskStatus.localPath],
          options.targetRoot,
          options.resourceName,
        );
        files = await listCurrentDownloadEpisodeFiles(
          localPaths,
          options.targetRoot,
          options.resourceName,
        );
        const bestLocalSummary = episodeFileSummary(files);
        complete = isCompleteEpisodeFileSet(files, options.episodeCount);
        ownership = await listCurrentOwnershipMaterials(
          localPaths,
          options.targetRoot,
          options.resourceName,
        );
        ownershipComplete = hasRequiredOwnershipMaterials(ownership, options.ownershipRequirements);
        posters = await listCurrentPosterImages(localPaths, options.targetRoot, options.resourceName);
        postersComplete = posters.length >= options.requiredPosterImages;
        signature = `${fileSetSignature(files)}#${ownershipSignature(ownership)}#${posterSignature(posters)}`;
        stableKey = localPaths.join("|") || playletDir(options.targetRoot, options.resourceName);
        stable = stableSignatures.get(stableKey);
        nextStable = {
          signature,
          count: complete && ownershipComplete && postersComplete && stable?.signature === signature
            ? stable.count + 1
            : complete && ownershipComplete && postersComplete ? 1 : 0,
        };
        stableSignatures.set(stableKey, nextStable);

        const progress = normalizeDownloadProgress(taskStatus.finishSize ?? 0, taskStatus.size);
        await options.onProgress?.({
          phase: "downloading",
          nativeStatus: taskStatus.status,
          speedText: taskStatus.rate,
          localPath: taskStatus.localPath,
          ...progress,
        });

        if (Date.now() - lastProgressLogAt > 15_000) {
          options.onLog?.(
            `[video-assets] 下载状态：${options.resourceName}` +
              (bestLocalSummary
                ? ` 本地识别=${bestLocalSummary.count}/${options.episodeCount}集` +
                  (bestLocalSummary.min !== undefined
                    ? `(${bestLocalSummary.min}-${bestLocalSummary.max})`
                    : "")
                : "") +
              ` 权属图片=${ownership.length}/${options.ownershipRequirements.minimumImages ?? 0}` +
              ` 海报封面=${posters.length}/${options.requiredPosterImages}` +
              (taskStatus.rate ? ` ${taskStatus.rate}` : "") +
              (taskStatus.status ? ` status=${taskStatus.status}` : ""),
          );
          lastProgressLogAt = Date.now();
        }

        const ownershipDirectoryComplete = ownership.length >= expectedOwnershipImages;
        const posterDownloadComplete = posters.length >= expectedPosterImages;
        if (
          (complete && ownershipComplete && ownershipDirectoryComplete && postersComplete && posterDownloadComplete && nextStable.count >= options.stableCompletePolls)
          || (taskStatus.completed && complete && ownershipComplete && ownershipDirectoryComplete && postersComplete && posterDownloadComplete)
        ) {
          const completedPath = await standardizeCompleteResources({
            files,
            ownership,
            posters,
            ownershipRequirements: options.ownershipRequirements,
            targetRoot: options.targetRoot,
            resourceName: options.resourceName,
            onLog: options.onLog,
          });
          if (options.mergeOwnershipMaterials) {
            await composeStandardizedOwnershipMaterials({ targetRoot: options.targetRoot, resourceName: options.resourceName, requirements: options.ownershipRequirements });
          }
          return completedPath;
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs));
  }

  for (const root of [options.targetRoot, options.sourceLocalPath].filter(
    (item): item is string => Boolean(item?.trim()),
  )) {
    await logEpisodeDirectoryDetails({
      root,
      resourceName: options.resourceName,
      episodeCount: options.episodeCount,
      reason: "等待下载完成超时",
      onLog: options.onLog,
    });
  }

  throw new Error(
    `等待百度网盘资源下载完成超时：${playletDir(options.targetRoot, options.resourceName)}`,
  );
}

export async function ensureBaiduNetdiskEpisodeVideos(
  options: EnsureBaiduNetdiskEpisodeVideosOptions,
): Promise<EnsureBaiduNetdiskEpisodeVideosResult> {
  const downloadDir = options.downloadDir || options.localEpisodeVideoRoot;
  const timeoutMs = options.timeoutMs ?? 12 * 60 * 60 * 1000;
  const pollIntervalMs = options.pollIntervalMs ?? 10_000;
  const stableCompletePolls = options.stableCompletePolls ?? 2;
  const targetLocalPath = playletDir(options.localEpisodeVideoRoot, options.resourceName);
  const ownershipRequirements = options.requiredOwnership ?? {};
  const requiredPosterImages = Math.max(0, options.requiredPosterImages ?? 0);
  const existingEpisodes = await listLocalEpisodeFiles({
    root: options.localEpisodeVideoRoot,
    resourceName: options.resourceName,
  });
  const existingOwnership = await listLocalOwnershipMaterials({
    root: options.localEpisodeVideoRoot,
    resourceName: options.resourceName,
  });
  const existingPosters = await listLocalPosterImages({
    root: options.localEpisodeVideoRoot,
    resourceName: options.resourceName,
  });

  if (
    isCompleteEpisodeFileSet(existingEpisodes, options.episodeCount)
    && hasRequiredOwnershipMaterials(existingOwnership, ownershipRequirements)
    && existingPosters.length >= requiredPosterImages
  ) {
    if (options.mergeOwnershipMaterials) {
      await composeStandardizedOwnershipMaterials({ targetRoot: options.localEpisodeVideoRoot, resourceName: options.resourceName, requirements: ownershipRequirements });
    }
    await options.onProgress?.({
      phase: "existing-complete",
      localPath: targetLocalPath,
      skippedExisting: true,
      progressPercent: 100,
    });
    return {
      localPath: targetLocalPath,
      skippedExisting: true,
      completed: true,
    };
  }

  await logEpisodeDirectoryDetails({
    root: options.localEpisodeVideoRoot,
    resourceName: options.resourceName,
    episodeCount: options.episodeCount,
    reason: "启动前未发现完整文件",
    onLog: options.onLog,
  });
  await options.onProgress?.({ phase: "scan", localPath: targetLocalPath });

  const result = await options.downloadShare({
    shareText: options.shareText,
    resourceName: options.resourceName,
    expectedEpisodeCount: isCompleteEpisodeFileSet(existingEpisodes, options.episodeCount)
      ? undefined
      : options.episodeCount,
    expectedOwnershipCounts: {
      minimumImages: Math.max(
        0,
        (ownershipRequirements.minimumImages ?? 0) - existingOwnership.length,
      ),
    },
    expectedPosterImages: Math.max(0, requiredPosterImages - existingPosters.length),
    downloadDir,
  });

  await options.onProgress?.({
    phase: "download-submitted",
    localPath: result.localPath,
    downloadRoot: result.downloadRoot,
    skippedExisting: result.skippedExisting,
  });

  const completedPath = await waitForCompleteLocalEpisodeVideos({
    targetRoot: options.localEpisodeVideoRoot,
    // The ownership directory is downloaded alongside the selected video directory;
    // scan the download root as well so both materials are standardized together.
    sourceLocalPath: result.localPath
      ? path.dirname(result.localPath)
      : result.downloadRoot ?? options.sourceLocalPath,
    resourceName: options.resourceName,
    downloadTaskName: result.share.name || options.downloadTaskName || options.resourceName,
    expectedOwnershipImages: result.expectedOwnershipImages,
    expectedPosterImages: result.expectedPosterImages,
    episodeCount: options.episodeCount,
    ownershipRequirements,
    requiredPosterImages,
    mergeOwnershipMaterials: options.mergeOwnershipMaterials,
    timeoutMs,
    pollIntervalMs,
    stableCompletePolls,
    getDownloadTaskStatus: options.getDownloadTaskStatus,
    onProgress: options.onProgress,
    onLog: options.onLog,
  });

  await options.onProgress?.({
    phase: "standardized",
    localPath: completedPath,
    progressPercent: 100,
  });

  return {
    localPath: completedPath,
    skippedExisting: result.skippedExisting,
    completed: true,
  };
}
