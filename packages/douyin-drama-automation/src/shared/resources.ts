import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  findOwnershipProjectProofFiles,
  listLocalOwnershipMaterials,
  listLocalPosterImages,
  prepareStretchedImageVariant,
  validateLocalEpisodeVideos,
} from "@drama/drama-media-assets";
import { log } from "./logger.js";
import type { ClaimedDouyinDramaTask, DouyinDramaRuntimeOptions } from "./types.js";

const supportedMaterialExtensions = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".bmp",
  ".webp",
]);

export function douyinDramaResourceName(task: ClaimedDouyinDramaTask) {
  return task.originalTitle.trim();
}

export function douyinDramaLocalRoot(options: DouyinDramaRuntimeOptions) {
  const root = options.localEpisodeVideoRoot?.trim();
  if (!root) throw new Error("DOUYIN_DRAMA_LOCAL_VIDEO_ROOT_REQUIRED");
  return root;
}

function playletResourceDir(task: ClaimedDouyinDramaTask, options: DouyinDramaRuntimeOptions) {
  return path.join(douyinDramaLocalRoot(options), douyinDramaResourceName(task));
}

async function walkFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

async function findLocalMaterialFiles(
  task: ClaimedDouyinDramaTask,
  options: DouyinDramaRuntimeOptions,
  keywords: string[],
) {
  const files = await walkFiles(playletResourceDir(task, options));
  return files
    .filter((file) => supportedMaterialExtensions.has(path.extname(file).toLowerCase()))
    .filter((file) => keywords.some((keyword) => file.replace(/\s+/g, "").includes(keyword)))
    .sort((left, right) => left.localeCompare(right, "zh-CN", { numeric: true }));
}

function remoteMaterialExtension(url: URL, contentType: string | null) {
  const urlExtension = path.extname(url.pathname);
  if (urlExtension && urlExtension.length <= 10) return urlExtension;
  const type = contentType?.split(";")[0].trim().toLowerCase();
  return ({
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/bmp": ".bmp",
    "image/webp": ".webp",
  } as Record<string, string>)[type ?? ""] ?? ".bin";
}

async function prepareMaterialReferences(
  references: string[],
  category: string,
  task: ClaimedDouyinDramaTask,
  options: DouyinDramaRuntimeOptions,
) {
  const outputDir = path.join(
    options.assetDownloadDir ?? path.resolve(process.cwd(), ".drama-runs/douyin-drama/assets"),
    "material-upload",
    category,
  );
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  return Promise.all(references.map(async (reference, index) => {
    if (!/^https?:\/\//i.test(reference)) {
      const candidate = path.isAbsolute(reference)
        ? reference
        : path.join(playletResourceDir(task, options), reference);
      const fileStat = await stat(candidate).catch(() => undefined);
      if (!fileStat?.isFile() || fileStat.size <= 0) {
        throw new Error(`DOUYIN_DRAMA_MATERIAL_FILE_NOT_FOUND: ${candidate}`);
      }
      return candidate;
    }

    const url = new URL(reference);
    const response = await fetch(reference, {
      redirect: "follow",
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      throw new Error(`DOUYIN_DRAMA_MATERIAL_DOWNLOAD_FAILED: HTTP ${response.status}: ${reference}`);
    }
    const extension = remoteMaterialExtension(url, response.headers.get("content-type"));
    const target = path.join(outputDir, `${category}-${index + 1}${extension}`);
    await writeFile(target, Buffer.from(await response.arrayBuffer()));
    log(options, `[douyin-drama] 公共材料下载完成：字段=${category} 文件=${target}`, undefined, "resources");
    return target;
  }));
}

function assertMaterialCount(label: string, files: string[], minimum: number, maximum?: number) {
  if (files.length < minimum || (maximum !== undefined && files.length > maximum)) {
    const expected = maximum === undefined ? `至少${minimum}个` : `${minimum}-${maximum}个`;
    throw new Error(`DOUYIN_DRAMA_MATERIAL_COUNT_INVALID: ${label}需要${expected}，实际=${files.length}`);
  }
}

export async function prepareDouyinDramaResources(
  task: ClaimedDouyinDramaTask,
  options: DouyinDramaRuntimeOptions,
) {
  const resourceName = douyinDramaResourceName(task);
  const localEpisodeVideoRoot = douyinDramaLocalRoot(options);
  await validateLocalEpisodeVideos({
    localEpisodeVideoRoot,
    resourceName,
    episodeCount: task.playlet.episodeCount,
  });

  const ownershipMaterials = await listLocalOwnershipMaterials({
    root: localEpisodeVideoRoot,
    resourceName,
    includePortraitImages: true,
  });
  if (task.playlet.costConfigurationFiles.length === 0) {
    task.playlet.costConfigurationFiles = await findLocalMaterialFiles(
      task,
      options,
      ["成本配置", "制作成本"],
    );
  }
  if (task.playlet.payCommitmentFiles.length === 0) {
    task.playlet.payCommitmentFiles = await findLocalMaterialFiles(
      task,
      options,
      ["片酬承诺"],
    );
  }
  if (task.playlet.ownershipProofFiles.length === 0) {
    const localCopyrightFiles = await findLocalMaterialFiles(
      task,
      options,
      ["版权证明", "权属文件", "制作协议", "授权协议"],
    );
    task.playlet.ownershipProofFiles = localCopyrightFiles.length > 0
      ? localCopyrightFiles.slice(0, 5)
      : ownershipMaterials.slice(0, 2).map((file) => file.file);
  }
  if (task.playlet.nonInfringementCommitmentFiles.length === 0) {
    task.playlet.nonInfringementCommitmentFiles = await findLocalMaterialFiles(
      task,
      options,
      ["不侵权承诺", "承诺函"],
    );
  }
  if (task.playlet.projectScreenshotFiles.length === 0) {
    if (options.ownershipProjectProofAiClientProvider) {
      try {
        const selection = await findOwnershipProjectProofFiles({
          getAiClient: options.ownershipProjectProofAiClientProvider,
          onLog: (message) => log(options, message, undefined, "resources"),
          root: localEpisodeVideoRoot,
          resourceName,
        });
        task.playlet.projectScreenshotFiles = selection.files;
      } catch (error) {
        log(
          options,
          `[douyin-drama] 权属工程截图智能分类失败，沿用原选择方式：${
            error instanceof Error ? error.message : String(error)
          }`,
          undefined,
          "resources",
        );
        task.playlet.projectScreenshotFiles = ownershipMaterials
          .slice(0, 5)
          .map((file) => file.file);
      }
    } else {
      task.playlet.projectScreenshotFiles = ownershipMaterials
        .slice(0, 5)
        .map((file) => file.file);
    }
  }

  const [
    costConfigurationFiles,
    payCommitmentFiles,
    ownershipProofFiles,
    nonInfringementCommitmentFiles,
    projectScreenshotFiles,
  ] = await Promise.all([
    prepareMaterialReferences(task.playlet.costConfigurationFiles, "cost-configuration", task, options),
    prepareMaterialReferences(task.playlet.payCommitmentFiles, "pay-commitment", task, options),
    prepareMaterialReferences(task.playlet.ownershipProofFiles, "ownership-proof", task, options),
    prepareMaterialReferences(
      task.playlet.nonInfringementCommitmentFiles,
      "non-infringement-commitment",
      task,
      options,
    ),
    prepareMaterialReferences(task.playlet.projectScreenshotFiles, "project-screenshots", task, options),
  ]);
  assertMaterialCount("成本配置情况", costConfigurationFiles, 1);
  assertMaterialCount("权属文件", ownershipProofFiles, 1);
  assertMaterialCount("不侵权承诺函", nonInfringementCommitmentFiles, 1);
  assertMaterialCount("工程文件截图", projectScreenshotFiles, 4, 5);
  task.playlet.costConfigurationFiles = costConfigurationFiles;
  task.playlet.payCommitmentFiles = payCommitmentFiles;
  task.playlet.ownershipProofFiles = ownershipProofFiles;
  task.playlet.nonInfringementCommitmentFiles = nonInfringementCommitmentFiles;
  task.playlet.projectScreenshotFiles = projectScreenshotFiles;

  const posters = await listLocalPosterImages({
    root: localEpisodeVideoRoot,
    resourceName,
    includeAllMatches: true,
  });
  if (posters.length === 0) {
    throw new Error("[poster-material-invalid] 未找到文件名或目录名包含‘封面’或‘海报’的图片");
  }
  const sourcePoster = posters.find((poster) => (
    poster.width !== undefined && poster.height !== undefined && poster.height > poster.width
  )) ?? posters[0];
  const outputDir = path.join(
    options.assetDownloadDir ?? path.resolve(process.cwd(), ".drama-runs/douyin-drama/assets"),
    "poster-upload",
  );
  await rm(outputDir, { recursive: true, force: true });
  const onResizeLog = (message: string) => log(options, `[douyin-drama] ${message}`, undefined, "resources");
  const [hongguoCover, douyinCover] = await Promise.all([
    prepareStretchedImageVariant({
      inputFile: sourcePoster.file,
      outputFile: path.join(outputDir, "hongguo-cover-700x1000.jpg"),
      width: 700,
      height: 1_000,
      jpegQuality: 92,
      maxFileBytes: 4_700_000,
      onLog: onResizeLog,
    }),
    prepareStretchedImageVariant({
      inputFile: sourcePoster.file,
      outputFile: path.join(outputDir, "douyin-cover-720x1080.jpg"),
      width: 720,
      height: 1_080,
      jpegQuality: 92,
      maxFileBytes: 4_700_000,
      onLog: onResizeLog,
    }),
  ]);
  task.playlet.localHongguoCoverFile = hongguoCover.file;
  task.playlet.localDouyinCoverFile = douyinCover.file;

  return {
    localEpisodeVideoRoot,
    resourceName,
    hongguoCoverFile: hongguoCover.file,
    douyinCoverFile: douyinCover.file,
    projectScreenshotFiles,
  };
}
