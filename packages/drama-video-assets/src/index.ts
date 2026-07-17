import { access, copyFile, link, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

export type LocalEpisodeVideo = {
  index: number;
  title: string;
  file: string;
};

export type LocalEpisodeFile = {
  index: number;
  file: string;
  size: number;
};

export type PreparedEpisodeUploadFiles = {
  uploadDir: string;
  files: string[];
};

export type EpisodeDirectorySummary = {
  dir: string;
  fileCount: number;
  directoryCount: number;
  matchedMp4: string[];
  unmatchedMp4: string[];
};

const knownEpisodeSubDirs = ["成片", "成品", "视频", "正片"];
const invalidUploadFileNameChars = new Set(["<", ">", ":", '"', "/", "\\", "|", "?", "*"]);

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pathExists(filePath: string) {
  return access(filePath).then(
    () => true,
    () => false,
  );
}

export function playletDir(root: string, resourceName: string) {
  return path.join(root, resourceName);
}

export function safeEpisodeFileBaseName(value: string) {
  return (
    Array.from(value, (char) =>
      invalidUploadFileNameChars.has(char) || char.charCodeAt(0) <= 0x1f ? " " : char,
    )
      .join("")
      .replace(/\s+/g, " ")
      .trim() || "短剧"
  );
}

export function localEpisodeFilePatterns(resourceName: string) {
  const escapedResourceName = escapeRegExp(resourceName);
  return [
    new RegExp(`^${escapedResourceName}(?:\\s*-\\s*|\\s*)第(\\d+)集.*\\.mp4$`, "i"),
    new RegExp(`^${escapedResourceName}(?:\\s*-\\s*|\\s*)(\\d+)\\s*集?.*\\.mp4$`, "i"),
    /^第(\d+)集.*\.mp4$/i,
    /^(?:ep|episode|e)[\s._-]*(\d+)\.mp4$/i,
    /^(\d+)\.mp4$/i,
  ];
}

export function localEpisodeScanDirs(root: string, resourceName: string) {
  const directory = playletDir(root, resourceName);
  return [directory, ...knownEpisodeSubDirs.map((subDir) => path.join(directory, subDir))];
}

export function matchLocalEpisodeIndex(fileName: string, resourceName: string) {
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

export async function listDirectLocalEpisodeFiles(
  scanDir: string,
  resourceName: string,
): Promise<LocalEpisodeFile[]> {
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

export async function recursiveLocalEpisodeScanDirs(root: string, resourceName: string) {
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

export async function listLocalEpisodeFiles(options: {
  root: string;
  resourceName: string;
  allowArbitraryDir?: boolean;
}) {
  const scanDirs = options.allowArbitraryDir
    ? await recursiveLocalEpisodeScanDirs(options.root, options.resourceName)
    : localEpisodeScanDirs(options.root, options.resourceName);
  const candidates: Array<{ dir: string; files: LocalEpisodeFile[] }> = [];

  for (const scanDir of scanDirs) {
    candidates.push({
      dir: scanDir,
      files: await listDirectLocalEpisodeFiles(scanDir, options.resourceName),
    });
  }

  const best = candidates.sort(
    (left, right) => right.files.length - left.files.length || left.dir.localeCompare(right.dir),
  )[0];
  return (best?.files ?? []).sort((left, right) => left.index - right.index);
}

export function isCompleteEpisodeFileSet(
  files: Array<{ index: number; file: string; size?: number }>,
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

export async function hasCompleteLocalEpisodeVideos(options: {
  root: string;
  resourceName: string;
  episodeCount: number;
}) {
  if (!(await pathExists(playletDir(options.root, options.resourceName)))) {
    return false;
  }

  const files = await listLocalEpisodeFiles({
    root: options.root,
    resourceName: options.resourceName,
  });
  return isCompleteEpisodeFileSet(files, options.episodeCount);
}

export function fileSetSignature(files: Array<{ index: number; size?: number }>) {
  return files.map((file) => `${file.index}:${file.size ?? 0}`).join("|");
}

export function episodeFileSummary(files: Array<{ index: number }>) {
  const indexes = [...new Set(files.map((file) => file.index))].sort((left, right) => left - right);
  return {
    count: indexes.length,
    min: indexes[0],
    max: indexes[indexes.length - 1],
  };
}

export function standardEpisodeFileName(resourceName: string, index: number) {
  return `${resourceName} - 第${index}集.mp4`;
}

function localEpisodeSourceDir(files: LocalEpisodeFile[]) {
  const dirs = [...new Set(files.map((file) => path.dirname(file.file)))];
  return dirs.length === 1 ? dirs[0] : undefined;
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

export async function standardizeEpisodeFilesToRoot(options: {
  files: LocalEpisodeFile[];
  targetRoot: string;
  resourceName: string;
  onLog?: (message: string) => void;
}) {
  const targetDir = playletDir(options.targetRoot, options.resourceName);
  const sourceDir = localEpisodeSourceDir(options.files);
  const sourceLabel = sourceDir ?? "多个目录";
  let workingFiles = [...options.files].sort(
    (left, right) => left.index - right.index || left.file.localeCompare(right.file),
  );
  let directoryRenamed = false;
  let targetExists = await pathExists(targetDir);

  options.onLog?.(`[video-assets] 标准化剧集目录和文件名：${sourceLabel} -> ${targetDir}`);

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
        options.onLog?.(
          `[video-assets] 标准化目录重命名失败，回退逐文件移动：${
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
    const targetFile = path.join(
      targetDir,
      standardEpisodeFileName(options.resourceName, file.index),
    );
    standardPaths.add(path.resolve(targetFile).toLowerCase());

    if (path.resolve(file.file).toLowerCase() === path.resolve(targetFile).toLowerCase()) continue;
    const operation = await moveOrCopyFile(file.file, targetFile);
    if (operation === "move") movedCount += 1;
    else copiedCount += 1;
  }

  const existingEntries = await readdir(targetDir, { withFileTypes: true }).catch(() => []);
  for (const entry of existingEntries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".mp4")) continue;

    const entryPath = path.join(targetDir, entry.name);
    if (standardPaths.has(path.resolve(entryPath).toLowerCase())) continue;
    await rm(entryPath, { force: true });
  }

  options.onLog?.(
    `[video-assets] 标准化剧集完成：目录重命名=${directoryRenamed ? "是" : "否"} 移动=${movedCount} 复制=${copiedCount}`,
  );

  return targetDir;
}

export async function findLocalEpisodeVideos(options: {
  localEpisodeVideoRoot: string;
  resourceName: string;
}): Promise<LocalEpisodeVideo[]> {
  const playletVideoDir = playletDir(options.localEpisodeVideoRoot, options.resourceName);
  if (!(await pathExists(playletVideoDir))) {
    throw new Error(`[local-video-invalid] 剧集视频目录不存在: ${playletVideoDir}`);
  }

  return (
    await listLocalEpisodeFiles({
      root: options.localEpisodeVideoRoot,
      resourceName: options.resourceName,
    })
  ).map((file) => ({
    index: file.index,
    title: `第${file.index}集`,
    file: file.file,
  }));
}

export async function validateLocalEpisodeVideos(options: {
  localEpisodeVideoRoot: string;
  resourceName: string;
  episodeCount: number;
}) {
  const episodes = await findLocalEpisodeVideos(options);
  const duplicateIndexes = episodes
    .filter((episode, index) => index > 0 && episode.index === episodes[index - 1].index)
    .map((episode) => episode.index);
  if (duplicateIndexes.length > 0) {
    throw new Error(
      `[local-video-invalid] 存在重复集数: ${[...new Set(duplicateIndexes)].join(", ")}`,
    );
  }

  const expectedIndexes = Array.from({ length: options.episodeCount }, (_, index) => index + 1);
  const actualIndexes = episodes.map((episode) => episode.index);
  if (
    actualIndexes.length !== expectedIndexes.length ||
    actualIndexes.some((value, index) => value !== expectedIndexes[index])
  ) {
    throw new Error(
      `[local-video-invalid] 剧集文件应按文件名匹配第1集至第${options.episodeCount}集: ` +
        `originalTitle=${options.resourceName} actual=[${actualIndexes.join(", ")}] dir=${playletDir(
          options.localEpisodeVideoRoot,
          options.resourceName,
        )}`,
    );
  }
}

async function createEpisodeUploadHardLink(source: string, target: string) {
  try {
    await link(source, target);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "EXDEV") {
      throw Object.assign(
        new Error(
          `[local-video-invalid] 无法为剧集视频创建硬链接，源文件和临时上传目录不在同一磁盘分区: ${source} -> ${target}; cause=${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
        { cause: error },
      );
    }
    throw error;
  }
}

export async function prepareEpisodeUploadFiles(options: {
  localEpisodeVideoRoot: string;
  resourceName: string;
  uploadRootDir: string;
  uploadBaseName?: string;
}): Promise<PreparedEpisodeUploadFiles> {
  const uploadDir = path.join(options.uploadRootDir, `episode-upload-${Date.now()}`);
  await mkdir(uploadDir, { recursive: true });

  const playletName = safeEpisodeFileBaseName(options.uploadBaseName ?? options.resourceName);
  const files: string[] = [];
  for (const episode of await findLocalEpisodeVideos(options)) {
    const extension = path.extname(episode.file) || ".mp4";
    const target = path.join(uploadDir, `${playletName}-第${episode.index}集${extension}`);
    await createEpisodeUploadHardLink(episode.file, target);
    files.push(target);
  }

  return { uploadDir, files };
}

export async function cleanupEpisodeUploadFiles(prepared: PreparedEpisodeUploadFiles) {
  await rm(prepared.uploadDir, { recursive: true, force: true }).catch(() => undefined);
}

export async function collectEpisodeDirectorySummaries(options: {
  root: string;
  resourceName: string;
  recursive?: boolean;
}): Promise<EpisodeDirectorySummary[]> {
  const scanDirs = options.recursive
    ? await recursiveLocalEpisodeScanDirs(options.root, options.resourceName)
    : localEpisodeScanDirs(options.root, options.resourceName);
  const summaries: EpisodeDirectorySummary[] = [];

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
      if (!entry.isFile()) continue;

      fileCount += 1;
      const fileStat = await stat(entryPath).catch(() => undefined);
      const size = fileStat?.isFile() ? fileStat.size : undefined;
      if (!entry.name.toLowerCase().endsWith(".mp4")) continue;

      const episodeIndex = matchLocalEpisodeIndex(entry.name, options.resourceName);
      if (episodeIndex === undefined) {
        unmatchedMp4.push(entry.name);
      } else {
        matchedMp4.push(
          `${episodeIndex}:${entry.name}${size === undefined ? "" : ` size=${size}`}`,
        );
      }
    }

    if (fileCount > 0 || directoryCount > 0 || matchedMp4.length > 0 || unmatchedMp4.length > 0) {
      summaries.push({ dir: scanDir, fileCount, directoryCount, matchedMp4, unmatchedMp4 });
    }
  }

  return summaries.sort(
    (left, right) =>
      right.matchedMp4.length - left.matchedMp4.length || left.dir.localeCompare(right.dir),
  );
}
