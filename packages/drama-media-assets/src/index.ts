import { access, copyFile, link, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";

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

export type LocalOwnershipMaterialFile = {
  index?: number;
  name: string;
  file: string;
  size: number;
};

export type OwnershipMaterialRequirements = { minimumImages?: number };

export type LocalOwnershipMaterialSet = LocalOwnershipMaterialFile[];

export type LocalPosterImageFile = {
  name: string;
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
const ownershipImageExtensions = new Set([".png", ".jpg", ".jpeg", ".bmp", ".webp"]);
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

async function recursiveDirs(root: string) {
  const dirs: string[] = [];
  const seen = new Set<string>();
  const queue = [root];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const resolved = path.resolve(current).toLowerCase();
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    dirs.push(current);

    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) queue.push(path.join(current, entry.name));
    }
  }

  return dirs;
}

function ownershipMaterialIndex(fileName: string) {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const match = stem.match(/(\d{1,4})\s*$/);
  return match ? Number(match[1]) : undefined;
}

async function deduplicateImagesByContent<T extends { file: string }>(files: T[]) {
  const seenContent = new Set<string>();
  const unique: T[] = [];
  for (const file of files) {
    const digest = createHash("sha256").update(await readFile(file.file)).digest("hex");
    if (seenContent.has(digest)) continue;
    seenContent.add(digest);
    unique.push(file);
  }
  return unique;
}

export async function listLocalOwnershipMaterials(options: {
  root: string;
  resourceName: string;
  rootIsResourceDir?: boolean;
}): Promise<LocalOwnershipMaterialSet> {
  const resourceDir = options.rootIsResourceDir ? options.root : playletDir(options.root, options.resourceName);
  const result: LocalOwnershipMaterialSet = [];
  const seenFiles = new Set<string>();

  for (const dir of await recursiveDirs(resourceDir)) {
    const directoryNames = [path.basename(resourceDir), ...path.relative(resourceDir, dir).split(path.sep)]
      .map((name) => name.replace(/\s+/g, ""));
    if (!directoryNames.some((name) => name.includes("工程") || name.includes("权属"))) continue;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !ownershipImageExtensions.has(path.extname(entry.name).toLowerCase())) continue;
      if (/-权属工程文件合成[12]\.jpg$/i.test(entry.name)) continue;
      const file = path.join(dir, entry.name);
      const resolved = path.resolve(file).toLowerCase();
      if (seenFiles.has(resolved)) continue;
      const fileStat = await stat(file).catch(() => undefined);
      if (!fileStat?.isFile() || fileStat.size <= 0) continue;
      seenFiles.add(resolved);
      result.push({
        index: ownershipMaterialIndex(entry.name),
        name: entry.name,
        file,
        size: fileStat.size,
      });
    }
  }

  result.sort((left, right) =>
    (left.index ?? Number.MAX_SAFE_INTEGER) - (right.index ?? Number.MAX_SAFE_INTEGER)
    || left.name.localeCompare(right.name, "zh-CN", { numeric: true })
    || left.file.localeCompare(right.file));
  return deduplicateImagesByContent(result);
}

export async function listLocalPosterImages(options: {
  root: string;
  resourceName: string;
  rootIsResourceDir?: boolean;
}): Promise<LocalPosterImageFile[]> {
  const resourceDir = options.rootIsResourceDir ? options.root : playletDir(options.root, options.resourceName);
  const namedCandidates: LocalPosterImageFile[] = [];
  const directoryCandidates: LocalPosterImageFile[] = [];
  const seenFiles = new Set<string>();

  for (const dir of await recursiveDirs(resourceDir)) {
    const entries = (await readdir(dir, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isFile() && ownershipImageExtensions.has(path.extname(entry.name).toLowerCase()))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN", { numeric: true }));
    const namedMatches = entries.filter((entry) => /封面|海报/.test(entry.name));
    const fromFileName = namedMatches.length > 0;
    const selectedEntries = fromFileName
      ? namedMatches
      : /封面|海报/.test(path.basename(dir)) && entries[0] ? [entries[0]] : [];
    for (const entry of selectedEntries) {
      const file = path.join(dir, entry.name);
      const resolved = path.resolve(file).toLowerCase();
      if (seenFiles.has(resolved)) continue;
      const fileStat = await stat(file).catch(() => undefined);
      if (!fileStat?.isFile() || fileStat.size <= 0) continue;
      seenFiles.add(resolved);
      (fromFileName ? namedCandidates : directoryCandidates).push({ name: entry.name, file, size: fileStat.size });
    }
  }

  const sortCandidates = (files: LocalPosterImageFile[]) => files.sort((left, right) =>
    Number(!left.name.includes("海报")) - Number(!right.name.includes("海报"))
    || left.name.localeCompare(right.name, "zh-CN", { numeric: true })
    || left.file.localeCompare(right.file));
  const selected = sortCandidates(namedCandidates)[0] ?? sortCandidates(directoryCandidates)[0];
  return selected ? [selected] : [];
}

export async function standardizePosterImagesToRoot(options: {
  files: LocalPosterImageFile[];
  targetRoot: string;
  resourceName: string;
  onLog?: (message: string) => void;
}) {
  const targetDir = path.join(playletDir(options.targetRoot, options.resourceName), "海报封面");
  const selected = options.files[0];
  const sourceBuffer = selected ? await readFile(selected.file) : undefined;
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  const standardized: LocalPosterImageFile[] = [];
  if (selected && sourceBuffer) {
    const extension = path.extname(selected.file).toLowerCase() || ".jpg";
    const target = path.join(targetDir, `${options.resourceName} - 海报${extension}`);
    await writeFile(target, sourceBuffer);
    const targetStat = await stat(target);
    standardized.push({ name: path.basename(target), file: target, size: targetStat.size });
  }
  options.onLog?.(`[video-assets] 海报封面标准化完成：图片=${standardized.length} dir=${targetDir}`);
  return standardized;
}

export function hasRequiredOwnershipMaterials(
  materials: LocalOwnershipMaterialSet,
  requirements: OwnershipMaterialRequirements = {},
) {
  return materials.length >= Math.max(0, requirements.minimumImages ?? 0);
}

export function selectRequiredOwnershipMaterials(
  materials: LocalOwnershipMaterialSet,
  requirements: OwnershipMaterialRequirements,
) {
  return materials.slice(0, Math.max(0, requirements.minimumImages ?? 0));
}

export async function standardizeOwnershipMaterialsToRoot(options: {
  materials: LocalOwnershipMaterialSet;
  requirements: OwnershipMaterialRequirements;
  targetRoot: string;
  resourceName: string;
  onLog?: (message: string) => void;
}) {
  const selected = options.materials;
  const targetDir = path.join(playletDir(options.targetRoot, options.resourceName), "权属文件");
  await mkdir(targetDir, { recursive: true });
  const standardized: LocalOwnershipMaterialSet = [];

  for (const [position, material] of selected.entries()) {
    const extension = path.extname(material.file).toLowerCase() || ".jpg";
    const target = path.join(targetDir, `${options.resourceName} - 权属工程文件${position + 1}${extension}`);
    if (!sameResolvedPath(material.file, target)) await copyFile(material.file, target);
    const targetStat = await stat(target);
    standardized.push({ ...material, index: position + 1, name: path.basename(target), file: target, size: targetStat.size });
  }

  options.onLog?.(
    `[video-assets] 权属材料标准化完成：图片=${standardized.length} dir=${targetDir}`,
  );
  return standardized;
}

export async function composeOwnershipMaterials(options: {
  files: LocalOwnershipMaterialFile[];
  outputDir: string;
  resourceName: string;
  onLog?: (message: string) => void;
}) {
  if (options.files.length === 0) throw new Error("[production-proof-invalid] 没有可合成的权属图片。");
  const labelHeight = 56;
  const padding = 12;
  const maxHeight = 1400;
  const prepared = await Promise.all(options.files.map(async (file) => {
    const image = sharp(file.file, { failOn: "error" });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) throw new Error(`[production-proof-invalid] 无法读取权属图片尺寸: ${file.file}`);
    const buffer = await image
      .resize({ height: maxHeight - labelHeight - padding * 2, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    const resized = await sharp(buffer).metadata();
    return { file, buffer, width: resized.width ?? metadata.width, height: resized.height ?? metadata.height };
  }));
  const canvasWidth = prepared.reduce((sum, item) => sum + item.width + padding * 2, 0);
  const canvasHeight = Math.max(...prepared.map((item) => item.height + labelHeight + padding * 2));
  const composites = prepared.map((item, index) => {
    const left = prepared.slice(0, index).reduce((sum, previous) => sum + previous.width + padding * 2, 0);
    const top = 0;
    const caption = Buffer.from(
      `<svg width="${item.width + padding * 2}" height="${labelHeight}"><style>text{font-family:Microsoft YaHei,Arial;font-size:24px;fill:#222}</style><text x="${padding}" y="38">权属${item.file.index ?? index + 1} · ${escapeXml(item.file.name)}</text></svg>`,
    );
    return [
      { input: caption, left, top },
      { input: item.buffer, left: left + padding, top: top + labelHeight + padding },
    ];
  }).flat();
  const outputBase = path.join(options.outputDir, `${safeEpisodeFileBaseName(options.resourceName)}-权属工程文件合成`);
  await mkdir(options.outputDir, { recursive: true });
  const pngPath = `${outputBase}.png`;
  await sharp({ create: { width: canvasWidth, height: canvasHeight, channels: 3, background: "white" } })
    .composite(composites)
    .png()
    .toFile(pngPath);
  const pngStat = await stat(pngPath);
  if (pngStat.size <= 9_500_000) return pngPath;
  const jpgPath = `${outputBase}.jpg`;
  await sharp(pngPath).jpeg({ quality: 82, progressive: true }).toFile(jpgPath);
  await rm(pngPath, { force: true });
  options.onLog?.(`[video-assets] 权属合成图超过10MB，已压缩为JPEG：${jpgPath}`);
  return jpgPath;
}

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[char] ?? char);
}

export async function composeOwnershipMaterialsIntoTwo(options: {
  files: LocalOwnershipMaterialFile[];
  outputDir: string;
  resourceName: string;
}) {
  if (options.files.length === 0) throw new Error("[production-proof-invalid] 没有可合成的权属图片。");
  const splitAt = Math.ceil(options.files.length / 2);
  const groups = [options.files.slice(0, splitAt), options.files.slice(splitAt)].filter((group) => group.length > 0);
  await mkdir(options.outputDir, { recursive: true });
  return Promise.all(groups.map(async (group, groupIndex) => {
    const source = await Promise.all(group.map(async (file) => {
      const metadata = await sharp(file.file, { failOn: "error" }).metadata();
      if (!metadata.width || !metadata.height) throw new Error(`[production-proof-invalid] 无法读取权属图片尺寸: ${file.file}`);
      return { file, width: metadata.width, height: metadata.height };
    }));
    const width = Math.min(2400, ...source.map((item) => item.width));
    const prepared = await Promise.all(source.map(async (item) => {
      const buffer = await sharp(item.file.file).resize({ width, withoutEnlargement: true }).png().toBuffer();
      const metadata = await sharp(buffer).metadata();
      return { buffer, width: metadata.width ?? width, height: metadata.height ?? item.height };
    }));
    const canvasWidth = Math.max(...prepared.map((item) => item.width));
    const canvasHeight = prepared.reduce((sum, item) => sum + item.height, 0);
    let top = 0;
    const composites = prepared.map((item) => {
      const result = { input: item.buffer, left: 0, top };
      top += item.height;
      return result;
    });
    const output = path.join(options.outputDir, `${safeEpisodeFileBaseName(options.resourceName)}-权属工程文件合成${groupIndex + 1}.jpg`);
    await sharp({ create: { width: canvasWidth, height: canvasHeight, channels: 3, background: "white" } })
      .composite(composites).jpeg({ quality: 92, progressive: true }).toFile(output);
    return output;
  }));
}

function sameResolvedPath(left: string, right: string) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
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
