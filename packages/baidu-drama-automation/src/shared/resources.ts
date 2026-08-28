import path from "node:path";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import {
  listLocalPosterImages,
  prepareStretchedImageVariant,
  validateLocalEpisodeVideos,
} from "@drama/drama-media-assets";
import { log } from "./logger.js";
import type { BaiduDramaRuntimeOptions, ClaimedBaiduDramaTask } from "./types.js";

export const BAIDU_DRAMA_LANDSCAPE_COVER_SIZE = {
  width: 1_280,
  height: 720,
} as const;

export const BAIDU_DRAMA_PORTRAIT_COVER_SIZE = {
  width: 1_200,
  height: 1_600,
} as const;

export function baiduDramaResourceName(task: ClaimedBaiduDramaTask) {
  return task.originalTitle.trim();
}

export function baiduDramaLocalRoot(options: BaiduDramaRuntimeOptions) {
  const root = options.localEpisodeVideoRoot?.trim();
  if (!root) throw new Error("BAIDU_DRAMA_LOCAL_VIDEO_ROOT_REQUIRED");
  return root;
}

function remoteMaterialExtension(url: URL, contentType: string | null) {
  const urlExtension = path.extname(url.pathname);
  if (urlExtension && urlExtension.length <= 10) return urlExtension;
  const type = contentType?.split(";")[0].trim().toLowerCase();
  return ({
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
  } as Record<string, string>)[type ?? ""] ?? ".bin";
}

async function prepareMaterialReferences(
  references: string[],
  category: string,
  options: BaiduDramaRuntimeOptions,
) {
  const outputDir = path.join(
    options.assetDownloadDir ?? path.resolve(process.cwd(), ".drama-runs/baidu-drama/assets"),
    "material-upload",
    category,
  );
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  return Promise.all(references.map(async (reference, index) => {
    if (!/^https?:\/\//i.test(reference)) {
      const fileStat = await stat(reference).catch(() => undefined);
      if (!fileStat?.isFile() || fileStat.size <= 0) {
        throw new Error(`BAIDU_DRAMA_MATERIAL_FILE_NOT_FOUND: ${reference}`);
      }
      return reference;
    }

    const url = new URL(reference);
    const response = await fetch(reference, {
      redirect: "follow",
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      throw new Error(`BAIDU_DRAMA_MATERIAL_DOWNLOAD_FAILED: HTTP ${response.status}: ${reference}`);
    }
    const extension = remoteMaterialExtension(url, response.headers.get("content-type"));
    const target = path.join(outputDir, `${category}-${index + 1}${extension}`);
    await writeFile(target, Buffer.from(await response.arrayBuffer()));
    log(options, `[baidu-drama] 公共材料下载完成：字段=${category} 文件=${target}`, undefined, "resources");
    return target;
  }));
}

export async function prepareBaiduDramaCoverVariants(options: {
  sourceFile: string;
  landscapeSourceFile?: string;
  portraitSourceFile?: string;
  outputDir: string;
  onLog?: (message: string) => void;
}) {
  await rm(options.outputDir, { recursive: true, force: true });
  const [landscape, portrait] = await Promise.all([
    prepareStretchedImageVariant({
      inputFile: options.landscapeSourceFile ?? options.sourceFile,
      outputFile: path.join(options.outputDir, "baidu-cover-landscape-1280x720.jpg"),
      ...BAIDU_DRAMA_LANDSCAPE_COVER_SIZE,
      jpegQuality: 92,
      maxFileBytes: 4_700_000,
      onLog: options.onLog,
    }),
    prepareStretchedImageVariant({
      inputFile: options.portraitSourceFile ?? options.sourceFile,
      outputFile: path.join(options.outputDir, "baidu-cover-portrait-1200x1600.jpg"),
      ...BAIDU_DRAMA_PORTRAIT_COVER_SIZE,
      jpegQuality: 92,
      maxFileBytes: 4_700_000,
      onLog: options.onLog,
    }),
  ]);
  return { landscape, portrait };
}

export async function prepareBaiduDramaResources(
  task: ClaimedBaiduDramaTask,
  options: BaiduDramaRuntimeOptions,
) {
  const resourceName = baiduDramaResourceName(task);
  const localEpisodeVideoRoot = baiduDramaLocalRoot(options);
  const [
    productionProofFiles,
    licenseProofFiles,
    qualificationProofFiles,
    costProofFiles,
    commitmentFiles,
  ] =
    await Promise.all([
      prepareMaterialReferences(
        task.playlet.copyright.productionProofFiles,
        "copyright-production",
        options,
      ),
      prepareMaterialReferences(
        task.playlet.copyright.licenseProofFiles,
        "copyright-license",
        options,
      ),
      prepareMaterialReferences(
        task.playlet.qualification.proofFiles,
        "qualification",
        options,
      ),
      prepareMaterialReferences(
        task.playlet.productionCost.proofFiles,
        "production-cost",
        options,
      ),
      prepareMaterialReferences(
        task.playlet.commitmentFiles,
        "commitment",
        options,
      ),
    ]);
  task.playlet.copyright.productionProofFiles = productionProofFiles;
  task.playlet.copyright.licenseProofFiles = licenseProofFiles;
  task.playlet.qualification.proofFiles = qualificationProofFiles;
  task.playlet.productionCost.proofFiles = costProofFiles;
  task.playlet.commitmentFiles = commitmentFiles;
  await validateLocalEpisodeVideos({
    localEpisodeVideoRoot,
    resourceName,
    episodeCount: task.playlet.episodeCount,
  });
  const posters = await listLocalPosterImages({
    root: localEpisodeVideoRoot,
    resourceName,
    includeAllMatches: true,
  });
  if (posters.length === 0) {
    throw new Error("[poster-material-invalid] 未找到文件名或目录名包含“封面”或“海报”的图片");
  }
  const coverSource = posters[0];
  const landscapeSource = posters.find((poster) => (
    poster.width !== undefined && poster.height !== undefined && poster.width >= poster.height
  )) ?? coverSource;
  const portraitSource = posters.find((poster) => (
    poster.width !== undefined && poster.height !== undefined && poster.height > poster.width
  )) ?? coverSource;
  const outputDir = path.join(
    options.assetDownloadDir ?? path.resolve(process.cwd(), ".drama-runs/baidu-drama/assets"),
    "poster-upload",
  );
  const onResizeLog = (message: string) =>
    log(options, `[baidu-drama] ${message}`, undefined, "resources");
  const { landscape, portrait } = await prepareBaiduDramaCoverVariants({
    sourceFile: coverSource.file,
    landscapeSourceFile: landscapeSource.file,
    portraitSourceFile: portraitSource.file,
    outputDir,
    onLog: onResizeLog,
  });
  task.playlet.localCoverFile = landscape.file;
  task.playlet.localLandscapeCoverFile = landscape.file;
  task.playlet.localPortraitCoverFile = portrait.file;
  return {
    coverFile: landscape.file,
    landscapeCoverFile: landscape.file,
    portraitCoverFile: portrait.file,
    localEpisodeVideoRoot,
    resourceName,
  };
}
