import path from "node:path";
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import {
  collectEpisodeDirectorySummaries,
  composeOwnershipMaterialsIntoTwo,
  episodeFileSummary,
  fileSetSignature,
  hasRequiredOwnershipMaterials,
  isOwnershipDirectoryName,
  isCompleteEpisodeFileSet,
  listDirectLocalEpisodeFiles,
  listLocalEpisodeFiles,
  listLocalAiProductionProofFiles,
  listLocalOwnershipMaterials,
  listLocalPosterImages,
  playletDir,
  standardizeEpisodeFilesToRoot,
  standardizeOwnershipMaterialsToRoot,
  standardizePosterImagesToRoot,
  standardizeAiProductionProofFilesToRoot,
  type LocalEpisodeFile,
  type LocalOwnershipMaterialSet,
  type LocalPosterImageFile,
  type LocalAiProductionProofFile,
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
  expectedOwnershipFiles?: number;
  expectedPosterImages?: number;
  expectedAiProductionProofFiles?: number;
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
  downloadEpisodeVideos?: boolean;
  forceAssetDownload?: boolean;
  requiredOwnership?: OwnershipMaterialRequirements;
  requiredOwnershipFiles?: number;
  requiredPosterImages?: number;
  requiredAiProductionProofFiles?: number;
  /** Wait for every remotely discovered optional asset instead of only caller requirements. */
  requireAllDiscoveredAssets?: boolean;
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
    expectedOwnershipFiles?: number;
    expectedPosterImages?: number;
    expectedAiProductionProofFiles?: number;
    downloadEpisodeVideos?: boolean;
    downloadDir: string;
  }) => Promise<BaiduNetdiskShareDownloadResult>;
  getDownloadTaskStatus?: (request: {
    targetName: string;
  }) => Promise<BaiduNetdiskDownloadTaskStatus | undefined>;
  onStableEpisodeFiles?: (files: LocalEpisodeFile[]) => void;
  onProgress?: (progress: BaiduNetdiskEpisodeVideoProgress) => void | Promise<void>;
  onLog?: (message: string) => void;
};

export type EnsureBaiduNetdiskEpisodeVideosResult = {
  localPath: string;
  skippedExisting: boolean;
  completed: boolean;
};

export function resolveBaiduNetdiskAssetCompletionRequirements(options: {
  requiredOwnershipImages?: number;
  requiredOwnershipFiles?: number;
  requiredPosterImages?: number;
  requiredAiProductionProofFiles?: number;
  discoveredOwnershipImages?: number;
  discoveredOwnershipFiles?: number;
  discoveredPosterImages?: number;
  discoveredAiProductionProofFiles?: number;
  requireAllDiscoveredAssets?: boolean;
}) {
  const count = (value: number | undefined) =>
    Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : 0;
  const requiredCount = (required: number | undefined, discovered: number | undefined) => {
    const normalizedRequired = count(required);
    return options.requireAllDiscoveredAssets
      ? Math.max(normalizedRequired, count(discovered))
      : normalizedRequired;
  };

  return {
    ownershipImages: requiredCount(
      options.requiredOwnershipImages,
      options.discoveredOwnershipImages,
    ),
    ownershipFiles: requiredCount(
      options.requiredOwnershipFiles,
      options.discoveredOwnershipFiles,
    ),
    posterImages: requiredCount(
      options.requiredPosterImages,
      options.discoveredPosterImages,
    ),
    aiProductionProofFiles: requiredCount(
      options.requiredAiProductionProofFiles,
      options.discoveredAiProductionProofFiles,
    ),
  };
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
  deduplicateByContent = true,
  includePortraitImages = false,
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
      deduplicateByContent,
      includePortraitImages,
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
    : await listLocalOwnershipMaterials({
        root: targetRoot,
        resourceName,
        deduplicateByContent,
        includePortraitImages,
      });
  return [...new Map(
    combined.map((file) => [path.resolve(file.file).toLowerCase(), file]),
  ).values()];
}

type LocalRawOwnershipFile = {
  file: string;
  size: number;
  modifiedAtMs: number;
};

async function listCurrentRawOwnershipFiles(
  localPaths: string[],
  targetRoot: string,
  resourceName: string,
) {
  const files = new Map<string, LocalRawOwnershipFile>();
  const roots = [...new Set([
    ...localPaths,
    playletDir(targetRoot, resourceName),
  ].map((item) => path.resolve(item)))];
  const walk = async (
    directory: string,
    inOwnershipDirectory: boolean,
    depth: number,
  ): Promise<void> => {
    if (depth > 8) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(
          file,
          inOwnershipDirectory || isOwnershipDirectoryName(entry.name),
          depth + 1,
        );
      } else if (
        inOwnershipDirectory
        && entry.isFile()
        && /\.(?:jpe?g|png|bmp|webp|pdf)$/i.test(entry.name)
      ) {
        const info = await stat(file).catch(() => undefined);
        if (info?.isFile() && info.size > 0) {
          files.set(path.resolve(file).toLowerCase(), {
            file,
            size: info.size,
            modifiedAtMs: info.mtimeMs,
          });
        }
      }
    }
  };
  for (const root of roots) {
    await walk(root, isOwnershipDirectoryName(path.basename(root)), 0);
  }
  return [...files.values()].sort((left, right) =>
    left.file.localeCompare(right.file, "zh-CN", { numeric: true })
  );
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

async function listCurrentAiProductionProofFiles(
  localPaths: string[],
  targetRoot: string,
  resourceName: string,
): Promise<LocalAiProductionProofFile[]> {
  const downloaded: LocalAiProductionProofFile[] = [];
  const seen = new Set<string>();
  for (const localPath of localPaths) {
    const key = path.resolve(localPath).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    downloaded.push(...await listLocalAiProductionProofFiles({
      root: localPath,
      resourceName,
      rootIsResourceDir: true,
    }));
  }
  return downloaded.length > 0
    ? downloaded
    : listLocalAiProductionProofFiles({ root: targetRoot, resourceName });
}

function ownershipSignature(materials: LocalOwnershipMaterialSet) {
  return materials
    .map((file) => `${file.file}:${file.size}`)
    .join("|");
}

function rawOwnershipSignature(files: LocalRawOwnershipFile[]) {
  return files.map((file) => `${file.file}:${file.size}:${file.modifiedAtMs}`).join("|");
}

async function preserveOwnershipDocuments(options: {
  files: LocalRawOwnershipFile[];
  targetRoot: string;
  resourceName: string;
  onLog?: (message: string) => void;
}) {
  const documents = options.files.filter((file) => path.extname(file.file).toLowerCase() === ".pdf");
  if (documents.length === 0) return;
  const targetDir = path.join(playletDir(options.targetRoot, options.resourceName), "权属文件");
  await mkdir(targetDir, { recursive: true });
  for (const document of documents) {
    const relative = path.relative(targetDir, document.file);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) continue;
    const parsed = path.parse(path.basename(document.file));
    let target = path.join(targetDir, parsed.base);
    let suffix = 1;
    while (true) {
      const existing = await stat(target).catch(() => undefined);
      if (!existing) break;
      if (existing.size === document.size) {
        target = "";
        break;
      }
      target = path.join(targetDir, `${parsed.name}-${suffix}${parsed.ext}`);
      suffix += 1;
    }
    if (target) await copyFile(document.file, target);
  }
  options.onLog?.(`[video-assets] 权属 PDF 持久化完成：文件=${documents.length} dir=${targetDir}`);
}

function posterSignature(files: LocalPosterImageFile[]) {
  return files.map((file) => `${file.file}:${file.size}`).join("|");
}

function aiProductionProofSignature(files: LocalAiProductionProofFile[]) {
  return files.map((file) => `${file.file}:${file.size}`).join("|");
}

async function standardizeCompleteResources(options: {
  files: LocalEpisodeFile[];
  ownership: LocalOwnershipMaterialSet;
  rawOwnershipFiles: LocalRawOwnershipFile[];
  posters: LocalPosterImageFile[];
  aiProductionProofs: LocalAiProductionProofFile[];
  ownershipRequirements: OwnershipMaterialRequirements;
  targetRoot: string;
  resourceName: string;
  standardizeEpisodeVideos?: boolean;
  onLog?: (message: string) => void;
}) {
  await standardizeOwnershipMaterialsToRoot({
    materials: options.ownership,
    requirements: options.ownershipRequirements,
    targetRoot: options.targetRoot,
    resourceName: options.resourceName,
    onLog: options.onLog,
  });
  await preserveOwnershipDocuments({
    files: options.rawOwnershipFiles,
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
  if (options.aiProductionProofs.length > 0) {
    await standardizeAiProductionProofFilesToRoot({
      files: options.aiProductionProofs,
      targetRoot: options.targetRoot,
      resourceName: options.resourceName,
      onLog: options.onLog,
    });
  }
  if (options.standardizeEpisodeVideos !== false) {
    return standardizeEpisodeFilesToRoot({
      files: options.files,
      targetRoot: options.targetRoot,
      resourceName: options.resourceName,
      onLog: options.onLog,
    });
  }
  return playletDir(options.targetRoot, options.resourceName);
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
  requireEpisodeVideos: boolean;
  ownershipRequirements: OwnershipMaterialRequirements;
  requiredOwnershipFiles: number;
  requiredPosterImages: number;
  requiredAiProductionProofFiles: number;
  mergeOwnershipMaterials?: boolean;
  sourceLocalPath?: string;
  downloadTaskName?: string;
  expectedOwnershipImages?: number;
  expectedOwnershipFiles?: number;
  expectedPosterImages?: number;
  expectedAiProductionProofFiles?: number;
  requireAllDiscoveredAssets?: boolean;
  timeoutMs: number;
  pollIntervalMs: number;
  stableCompletePolls: number;
  getDownloadTaskStatus?: EnsureBaiduNetdiskEpisodeVideosOptions["getDownloadTaskStatus"];
  onStableEpisodeFiles?: EnsureBaiduNetdiskEpisodeVideosOptions["onStableEpisodeFiles"];
  onProgress?: EnsureBaiduNetdiskEpisodeVideosOptions["onProgress"];
  onLog?: EnsureBaiduNetdiskEpisodeVideosOptions["onLog"];
}) {
  const startedAt = Date.now();
  const assetRequirements = resolveBaiduNetdiskAssetCompletionRequirements({
    requiredOwnershipImages: options.ownershipRequirements.minimumImages,
    requiredOwnershipFiles: options.requiredOwnershipFiles,
    requiredPosterImages: options.requiredPosterImages,
    requiredAiProductionProofFiles: options.requiredAiProductionProofFiles,
    discoveredOwnershipImages: options.expectedOwnershipImages,
    discoveredOwnershipFiles: options.expectedOwnershipFiles,
    discoveredPosterImages: options.expectedPosterImages,
    discoveredAiProductionProofFiles: options.expectedAiProductionProofFiles,
    requireAllDiscoveredAssets: options.requireAllDiscoveredAssets,
  });
  const stableSignatures = new Map<string, { signature: string; count: number }>();
  const stableEpisodeFiles = new Map<string, {
    signature: string;
    count: number;
    dispatchedSignature?: string;
  }>();
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
    const newlyStableFiles: LocalEpisodeFile[] = [];
    for (const file of files) {
      const key = path.resolve(file.file).toLowerCase();
      const signature = `${file.size}:${file.modifiedAtMs}`;
      const previous = stableEpisodeFiles.get(key);
      const current = {
        signature,
        count: previous?.signature === signature ? previous.count + 1 : 1,
        dispatchedSignature: previous?.dispatchedSignature,
      };
      if (
        current.count >= options.stableCompletePolls
        && current.dispatchedSignature !== signature
      ) {
        current.dispatchedSignature = signature;
        newlyStableFiles.push(file);
      }
      stableEpisodeFiles.set(key, current);
    }
    if (newlyStableFiles.length > 0) {
      options.onStableEpisodeFiles?.(newlyStableFiles);
    }
    let complete = !options.requireEpisodeVideos
      || isCompleteEpisodeFileSet(files, options.episodeCount);
    let ownership = await listCurrentOwnershipMaterials(
      localPaths,
      options.targetRoot,
      options.resourceName,
    );
    let rawOwnershipFiles = await listCurrentOwnershipMaterials(
      localPaths,
      options.targetRoot,
      options.resourceName,
      false,
      true,
    );
    let ownershipSourceFiles = await listCurrentRawOwnershipFiles(
      localPaths,
      options.targetRoot,
      options.resourceName,
    );
    let ownershipComplete = hasRequiredOwnershipMaterials(ownership, options.ownershipRequirements);
    let posters = await listCurrentPosterImages(localPaths, options.targetRoot, options.resourceName);
    let postersComplete = posters.length >= options.requiredPosterImages;
    let aiProductionProofs = await listCurrentAiProductionProofFiles(
      localPaths,
      options.targetRoot,
      options.resourceName,
    );
    let aiProductionProofsComplete = aiProductionProofs.length >= options.requiredAiProductionProofFiles;
    let signature = `${fileSetSignature(files)}#${ownershipSignature(ownership)}#${rawOwnershipSignature(ownershipSourceFiles)}#${posterSignature(posters)}#${aiProductionProofSignature(aiProductionProofs)}`;
    let stableKey = localPaths.join("|") || playletDir(options.targetRoot, options.resourceName);
    let stable = stableSignatures.get(stableKey);
    let nextStable = {
      signature,
      count: complete && ownershipComplete && postersComplete && aiProductionProofsComplete && stable?.signature === signature
        ? stable.count + 1
        : complete && ownershipComplete && postersComplete && aiProductionProofsComplete ? 1 : 0,
    };
    stableSignatures.set(stableKey, nextStable);

    const ownershipDirectoryComplete =
      rawOwnershipFiles.length >= assetRequirements.ownershipImages
      && ownershipSourceFiles.length >= assetRequirements.ownershipFiles;
    const posterDownloadComplete = posters.length >= assetRequirements.posterImages;
    const aiProductionProofDownloadComplete =
      aiProductionProofs.length >= assetRequirements.aiProductionProofFiles;
    if (complete && ownershipComplete && ownershipDirectoryComplete && postersComplete && posterDownloadComplete && aiProductionProofsComplete && aiProductionProofDownloadComplete && nextStable.count >= options.stableCompletePolls) {
      const completedPath = await standardizeCompleteResources({
        files,
        ownership,
        rawOwnershipFiles: ownershipSourceFiles,
        posters,
        aiProductionProofs,
        ownershipRequirements: options.ownershipRequirements,
        targetRoot: options.targetRoot,
        resourceName: options.resourceName,
        standardizeEpisodeVideos: options.requireEpisodeVideos,
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
        complete = !options.requireEpisodeVideos
          || isCompleteEpisodeFileSet(files, options.episodeCount);
        ownership = await listCurrentOwnershipMaterials(
          localPaths,
          options.targetRoot,
          options.resourceName,
        );
        rawOwnershipFiles = await listCurrentOwnershipMaterials(
          localPaths,
          options.targetRoot,
          options.resourceName,
          false,
          true,
        );
        ownershipSourceFiles = await listCurrentRawOwnershipFiles(
          localPaths,
          options.targetRoot,
          options.resourceName,
        );
        ownershipComplete = hasRequiredOwnershipMaterials(ownership, options.ownershipRequirements);
        posters = await listCurrentPosterImages(localPaths, options.targetRoot, options.resourceName);
        postersComplete = posters.length >= options.requiredPosterImages;
        aiProductionProofs = await listCurrentAiProductionProofFiles(
          localPaths,
          options.targetRoot,
          options.resourceName,
        );
        aiProductionProofsComplete = aiProductionProofs.length >= options.requiredAiProductionProofFiles;
        signature = `${fileSetSignature(files)}#${ownershipSignature(ownership)}#${rawOwnershipSignature(ownershipSourceFiles)}#${posterSignature(posters)}#${aiProductionProofSignature(aiProductionProofs)}`;
        stableKey = localPaths.join("|") || playletDir(options.targetRoot, options.resourceName);
        stable = stableSignatures.get(stableKey);
        nextStable = {
          signature,
          count: complete && ownershipComplete && postersComplete && aiProductionProofsComplete && stable?.signature === signature
            ? stable.count + 1
            : complete && ownershipComplete && postersComplete && aiProductionProofsComplete ? 1 : 0,
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
              ` 权属原始图片=${rawOwnershipFiles.length}/${assetRequirements.ownershipImages}` +
              ` 权属全部文件=${ownershipSourceFiles.length}/${assetRequirements.ownershipFiles}` +
              ` 权属远端发现=${options.expectedOwnershipImages ?? 0}图/${options.expectedOwnershipFiles ?? 0}文件` +
              ` 海报封面=${posters.length}/${options.requiredPosterImages}` +
              ` AI制作证明=${aiProductionProofs.length}/${options.requiredAiProductionProofFiles}` +
              (taskStatus.rate ? ` ${taskStatus.rate}` : "") +
              (taskStatus.status ? ` status=${taskStatus.status}` : ""),
          );
          lastProgressLogAt = Date.now();
        }

        const ownershipDirectoryComplete =
          rawOwnershipFiles.length >= assetRequirements.ownershipImages
          && ownershipSourceFiles.length >= assetRequirements.ownershipFiles;
        const posterDownloadComplete = posters.length >= assetRequirements.posterImages;
        const aiProductionProofDownloadComplete =
          aiProductionProofs.length >= assetRequirements.aiProductionProofFiles;
        if (taskStatus.completed && ownershipDirectoryComplete && !ownershipComplete) {
          throw new Error(
            `百度网盘权属材料筛选后数量不足。至少需要${options.ownershipRequirements.minimumImages ?? 0}张非竖图，实际找到${ownership.length}张；高度大于宽度的图片不会作为权属文件。`,
          );
        }
        if (
          (complete && ownershipComplete && ownershipDirectoryComplete && postersComplete && posterDownloadComplete && aiProductionProofsComplete && aiProductionProofDownloadComplete && nextStable.count >= options.stableCompletePolls)
          || (taskStatus.completed && complete && ownershipComplete && ownershipDirectoryComplete && postersComplete && posterDownloadComplete && aiProductionProofsComplete && aiProductionProofDownloadComplete)
        ) {
          const completedPath = await standardizeCompleteResources({
            files,
            ownership,
            rawOwnershipFiles: ownershipSourceFiles,
            posters,
            aiProductionProofs,
            ownershipRequirements: options.ownershipRequirements,
            targetRoot: options.targetRoot,
            resourceName: options.resourceName,
            standardizeEpisodeVideos: options.requireEpisodeVideos,
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
    `等待百度网盘资源下载完成超时（${Math.round(options.timeoutMs / 6_000) / 10}分钟）：` +
      playletDir(options.targetRoot, options.resourceName),
  );
}

export async function ensureBaiduNetdiskEpisodeVideos(
  options: EnsureBaiduNetdiskEpisodeVideosOptions,
): Promise<EnsureBaiduNetdiskEpisodeVideosResult> {
  const downloadDir = options.downloadDir || options.localEpisodeVideoRoot;
  const timeoutMs = options.timeoutMs ?? 60 * 60 * 1000;
  const pollIntervalMs = options.pollIntervalMs ?? 10_000;
  const stableCompletePolls = options.stableCompletePolls ?? 2;
  const downloadEpisodeVideos = options.downloadEpisodeVideos !== false;
  const targetLocalPath = playletDir(options.localEpisodeVideoRoot, options.resourceName);
  const ownershipRequirements = options.requiredOwnership ?? {};
  const requiredOwnershipFiles = Math.max(0, options.requiredOwnershipFiles ?? 0);
  const requiredPosterImages = Math.max(0, options.requiredPosterImages ?? 0);
  const requiredAiProductionProofFiles = Math.max(0, options.requiredAiProductionProofFiles ?? 0);
  const existingEpisodes = await listLocalEpisodeFiles({
    root: options.localEpisodeVideoRoot,
    resourceName: options.resourceName,
  });
  const existingOwnership = await listLocalOwnershipMaterials({
    root: options.localEpisodeVideoRoot,
    resourceName: options.resourceName,
  });
  const existingRawOwnershipFiles = await listCurrentRawOwnershipFiles(
    [targetLocalPath],
    options.localEpisodeVideoRoot,
    options.resourceName,
  );
  const existingPosters = await listLocalPosterImages({
    root: options.localEpisodeVideoRoot,
    resourceName: options.resourceName,
  });
  const existingAiProductionProofs = await listLocalAiProductionProofFiles({
    root: options.localEpisodeVideoRoot,
    resourceName: options.resourceName,
  });

  if (
    !options.forceAssetDownload
    &&
    (!downloadEpisodeVideos || isCompleteEpisodeFileSet(existingEpisodes, options.episodeCount))
    && hasRequiredOwnershipMaterials(existingOwnership, ownershipRequirements)
    && existingRawOwnershipFiles.length >= requiredOwnershipFiles
    && existingPosters.length >= requiredPosterImages
    && existingAiProductionProofs.length >= requiredAiProductionProofFiles
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

  if (downloadEpisodeVideos) {
    await logEpisodeDirectoryDetails({
      root: options.localEpisodeVideoRoot,
      resourceName: options.resourceName,
      episodeCount: options.episodeCount,
      reason: "启动前未发现完整文件",
      onLog: options.onLog,
    });
  }
  await options.onProgress?.({ phase: "scan", localPath: targetLocalPath });

  const result = await options.downloadShare({
    shareText: options.shareText,
    resourceName: options.resourceName,
    expectedEpisodeCount: !downloadEpisodeVideos
      || isCompleteEpisodeFileSet(existingEpisodes, options.episodeCount)
      ? undefined
      : options.episodeCount,
    expectedOwnershipCounts: {
      minimumImages: Math.max(
        0,
        (ownershipRequirements.minimumImages ?? 0) - existingOwnership.length,
      ),
    },
    expectedOwnershipFiles: Math.max(
      0,
      requiredOwnershipFiles - existingRawOwnershipFiles.length,
    ),
    expectedPosterImages: Math.max(0, requiredPosterImages - existingPosters.length),
    expectedAiProductionProofFiles: Math.max(
      0,
      requiredAiProductionProofFiles - existingAiProductionProofs.length,
    ),
    downloadEpisodeVideos,
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
    expectedOwnershipFiles: result.expectedOwnershipFiles,
    expectedPosterImages: result.expectedPosterImages,
    expectedAiProductionProofFiles: result.expectedAiProductionProofFiles,
    requireAllDiscoveredAssets: options.requireAllDiscoveredAssets,
    episodeCount: options.episodeCount,
    requireEpisodeVideos: downloadEpisodeVideos,
    ownershipRequirements,
    requiredOwnershipFiles,
    requiredPosterImages,
    requiredAiProductionProofFiles,
    mergeOwnershipMaterials: options.mergeOwnershipMaterials,
    timeoutMs,
    pollIntervalMs,
    stableCompletePolls,
    getDownloadTaskStatus: options.getDownloadTaskStatus,
    onStableEpisodeFiles: options.onStableEpisodeFiles,
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
