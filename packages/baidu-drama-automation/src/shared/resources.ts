import { analyzeImagesAsJson, type DramaAiClient } from "@drama/ai";
import { createHash } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import {
  listLocalPosterImages,
  prepareCroppedImageVariant,
  readImageDimensions,
  validateLocalEpisodeVideos,
} from "@drama/drama-media-assets";
import { z } from "zod";
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

type BaiduCoverKind = "landscape" | "portrait";

const baiduAiCoverPromptVersion = "baidu-counterpart-cover-v2-text-safety";
const baiduAiCoverGenerationAttempts = 3;
const activeAiCoverGenerations = new Map<string, Promise<string>>();

const baiduAiCoverValidationSchema = z.object({
  titleTextExact: z.boolean(),
  titleOccursOnce: z.boolean(),
  unrelatedTextFree: z.boolean(),
  noWatermarkOrTechnicalOverlay: z.boolean(),
  issues: z.array(z.string().trim().max(300)).max(20).default([]),
});

const baiduCoverDetails = {
  landscape: {
    label: "16:9 横版",
    promptLabel: "宽幅横向",
    outputName: "baidu-cover-landscape-1280x720.jpg",
    size: "2560x1440",
    target: BAIDU_DRAMA_LANDSCAPE_COVER_SIZE,
  },
  portrait: {
    label: "3:4 竖版",
    promptLabel: "纵向",
    outputName: "baidu-cover-portrait-1200x1600.jpg",
    size: "1536x2048",
    target: BAIDU_DRAMA_PORTRAIT_COVER_SIZE,
  },
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

async function isPreparedCover(file: string, kind: BaiduCoverKind) {
  const fileStat = await stat(file).catch(() => undefined);
  if (!fileStat?.isFile() || fileStat.size <= 0) return false;
  const dimensions = await readImageDimensions(file).catch(() => undefined);
  const target = baiduCoverDetails[kind].target;
  return dimensions?.width === target.width && dimensions.height === target.height;
}

function baiduCounterpartCoverPrompt(options: {
  kind: BaiduCoverKind;
  sourceKind: BaiduCoverKind | "generic";
  title: string;
}) {
  const target = baiduCoverDetails[options.kind];
  const sourceDescription = options.sourceKind === "landscape"
    ? "横向"
    : options.sourceKind === "portrait"
      ? "纵向"
      : "通用";
  return [
    `根据参考的${sourceDescription}封面，为百度短剧生成一张${target.promptLabel}封面。`,
    "保持参考图中的核心人物、人物关系、服饰、时代背景、色彩气质和作品辨识度。",
    `重新构图并自然扩展画面，使最终画面适合${target.promptLabel}展示；不要简单拉伸、镜像、重复拼接、裁掉主体或添加边框。`,
    "人物面部、关键道具和剧名位于安全区域，画面完整清晰。",
    "画面中只能出现一处准确作品名；除作品名外，严禁出现任何文字、字母、数字或类似文字的符号。",
    "尤其不得出现演员姓名、演员表、职员表、署名、字幕、副标题、宣传语、集数、日期、时间、画幅比例、分辨率、相机参数、平台标志、水印、角标、二维码、信息栏或伪界面。",
    "参考图若含作品名以外的文字，必须删除，不得复制、改写或补全；不要预留演员名或字幕排版区域。",
    `作品名：${options.title}。`,
  ].join("\n");
}

async function validateBaiduGeneratedCover(options: {
  generatedFile: string;
  title: string;
  aiClient: DramaAiClient;
}) {
  const completion = await analyzeImagesAsJson(options.aiClient, {
    images: [{ type: "file", path: options.generatedFile, detail: "high" }],
    prompt: [
      "你是短剧封面文字质检员。检查图片中的全部可见文字、字母、数字和类似文字的符号。",
      `唯一允许的文字是准确作品名：“${options.title}”，必须完整准确且只出现一次。`,
      "演员姓名、演员表、职员表、署名、字幕、副标题、宣传语、集数、日期、时间，以及任何画幅比例、尺寸、分辨率或相机参数都不允许出现。",
      "平台标志、水印、角标、二维码、信息栏、字幕条、取景框和其他伪界面元素也不允许出现。",
      "只返回 JSON 对象，不要 Markdown 或解释。格式：" + JSON.stringify({
        titleTextExact: true,
        titleOccursOnce: true,
        unrelatedTextFree: true,
        noWatermarkOrTechnicalOverlay: true,
        issues: [],
      }),
    ].join("\n"),
    systemPrompt: "你只输出符合用户指定结构的 JSON 对象。",
    maxTokens: 700,
    temperature: 0,
  });
  const validation = baiduAiCoverValidationSchema.parse(completion.data);
  const failures = [
    !validation.titleTextExact && "作品名不准确",
    !validation.titleOccursOnce && "作品名不是只出现一次",
    !validation.unrelatedTextFree && "检测到作品名以外的文字",
    !validation.noWatermarkOrTechnicalOverlay && "检测到水印或技术标注",
    ...validation.issues,
  ].filter((issue): issue is string => Boolean(issue));
  return { passed: failures.length === 0, failures };
}

async function generateMissingBaiduCover(options: {
  referenceFile: string;
  sourceKind: BaiduCoverKind | "generic";
  kind: BaiduCoverKind;
  title: string;
  cacheDir: string;
  aiImageModel: string;
  getAiClient: () => DramaAiClient;
  onLog?: (message: string) => void;
}) {
  const reference = await readFile(options.referenceFile);
  const cacheKey = createHash("sha256")
    .update(reference)
    .update(options.aiImageModel)
    .update(options.title)
    .update(options.kind)
    .update(baiduAiCoverPromptVersion)
    .digest("hex")
    .slice(0, 24);
  const cacheDirectory = path.join(options.cacheDir, cacheKey);
  const output = path.join(cacheDirectory, baiduCoverDetails[options.kind].outputName);
  if (await isPreparedCover(output, options.kind)) {
    options.onLog?.(`[baidu-cover-ai] 复用 AI ${baiduCoverDetails[options.kind].label}封面：${output}`);
    return output;
  }

  const active = activeAiCoverGenerations.get(cacheKey);
  if (active) return active;
  const operation = (async () => {
    if (await isPreparedCover(output, options.kind)) return output;
    await mkdir(cacheDirectory, { recursive: true });
    options.onLog?.(
      `[baidu-cover-ai] 正在根据${options.sourceKind === "portrait" ? "竖版" : options.sourceKind === "landscape" ? "横版" : "通用"}封面` +
        `生成${baiduCoverDetails[options.kind].label}封面，模型=${options.aiImageModel}`,
    );
    const aiClient = options.getAiClient();
    const basePrompt = baiduCounterpartCoverPrompt(options);
    let lastError: unknown;
    for (let attempt = 1; attempt <= baiduAiCoverGenerationAttempts; attempt += 1) {
      const nonce = `${process.pid}-${Date.now()}-${attempt}`;
      const temporarySource = path.join(
        cacheDirectory,
        `.generated-${options.kind}-${nonce}.image`,
      );
      const temporaryOutput = path.join(
        cacheDirectory,
        `.prepared-${options.kind}-${nonce}.jpg`,
      );
      try {
        const retryInstruction = attempt > 1
          ? "\n\n上一张图片未通过文字验收。请重新生成，并严格确保除唯一且准确的作品名外没有任何文字、字母、数字、署名、字幕或技术标注。"
          : "";
        const result = await aiClient.generateImage({
          model: options.aiImageModel,
          prompt: basePrompt + retryInstruction,
          referenceImages: [{ type: "file", path: options.referenceFile }],
          size: baiduCoverDetails[options.kind].size,
          watermark: false,
        });
        const generated = result.images[0];
        if (!generated?.data.length) {
          throw new Error("BAIDU_DRAMA_AI_COVER_RESPONSE_MISSING");
        }
        await writeFile(temporarySource, Buffer.from(generated.data));
        await prepareCroppedImageVariant({
          inputFile: temporarySource,
          outputFile: temporaryOutput,
          ...baiduCoverDetails[options.kind].target,
          jpegQuality: 92,
          maxFileBytes: 4_700_000,
          onLog: options.onLog,
        });
        const validation = await validateBaiduGeneratedCover({
          generatedFile: temporaryOutput,
          title: options.title,
          aiClient,
        });
        if (!validation.passed) {
          throw new Error(
            `BAIDU_DRAMA_AI_COVER_TEXT_VALIDATION_FAILED: ${validation.failures.join("；")}`,
          );
        }
        await rm(output, { force: true });
        await rename(temporaryOutput, output);
        options.onLog?.(
          `[baidu-cover-ai] AI ${baiduCoverDetails[options.kind].label}封面通过文字验收：${output}`,
        );
        return output;
      } catch (error) {
        lastError = error;
        options.onLog?.(
          `[baidu-cover-ai] AI 封面生成或文字验收失败：${attempt}/${baiduAiCoverGenerationAttempts} ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        await Promise.all([
          rm(temporarySource, { force: true }).catch(() => undefined),
          rm(temporaryOutput, { force: true }).catch(() => undefined),
        ]);
      }
    }
    throw Object.assign(new Error("BAIDU_DRAMA_AI_COVER_GENERATION_FAILED"), {
      cause: lastError,
    });
  })().finally(() => {
    activeAiCoverGenerations.delete(cacheKey);
  });
  activeAiCoverGenerations.set(cacheKey, operation);
  return operation;
}

export async function prepareBaiduDramaCoverVariants(options: {
  sourceFile: string;
  landscapeSourceFile?: string;
  portraitSourceFile?: string;
  title: string;
  outputDir: string;
  aiCacheDir?: string;
  aiImageModel?: string;
  createAiClient?: () => DramaAiClient;
  onLog?: (message: string) => void;
}) {
  await rm(options.outputDir, { recursive: true, force: true });
  const aiCacheDir = options.aiCacheDir ?? path.join(path.dirname(options.outputDir), "ai-cover-cache");
  let landscapeSourceFile = options.landscapeSourceFile;
  let portraitSourceFile = options.portraitSourceFile;
  const needsAi = !landscapeSourceFile || !portraitSourceFile;
  let aiClient: DramaAiClient | undefined;
  const getAiClient = () => {
    if (aiClient) return aiClient;
    if (!options.createAiClient) throw new Error("DRAMA_AI_API_KEY_REQUIRED");
    aiClient = options.createAiClient();
    return aiClient;
  };
  const aiImageModel = needsAi ? options.aiImageModel?.trim() : undefined;
  if (needsAi && !aiImageModel) throw new Error("DRAMA_AI_IMAGE_MODEL_REQUIRED");

  if (!landscapeSourceFile && portraitSourceFile) {
    landscapeSourceFile = await generateMissingBaiduCover({
      referenceFile: portraitSourceFile,
      sourceKind: "portrait",
      kind: "landscape",
      title: options.title,
      cacheDir: aiCacheDir,
      aiImageModel: aiImageModel!,
      getAiClient,
      onLog: options.onLog,
    });
  } else if (!portraitSourceFile && landscapeSourceFile) {
    portraitSourceFile = await generateMissingBaiduCover({
      referenceFile: landscapeSourceFile,
      sourceKind: "landscape",
      kind: "portrait",
      title: options.title,
      cacheDir: aiCacheDir,
      aiImageModel: aiImageModel!,
      getAiClient,
      onLog: options.onLog,
    });
  } else if (!landscapeSourceFile && !portraitSourceFile) {
    [landscapeSourceFile, portraitSourceFile] = await Promise.all([
      generateMissingBaiduCover({
        referenceFile: options.sourceFile,
        sourceKind: "generic",
        kind: "landscape",
        title: options.title,
        cacheDir: aiCacheDir,
        aiImageModel: aiImageModel!,
        getAiClient,
        onLog: options.onLog,
      }),
      generateMissingBaiduCover({
        referenceFile: options.sourceFile,
        sourceKind: "generic",
        kind: "portrait",
        title: options.title,
        cacheDir: aiCacheDir,
        aiImageModel: aiImageModel!,
        getAiClient,
        onLog: options.onLog,
      }),
    ]);
  }

  const [landscape, portrait] = await Promise.all([
    prepareCroppedImageVariant({
      inputFile: landscapeSourceFile!,
      outputFile: path.join(options.outputDir, "baidu-cover-landscape-1280x720.jpg"),
      ...BAIDU_DRAMA_LANDSCAPE_COVER_SIZE,
      jpegQuality: 92,
      maxFileBytes: 4_700_000,
      onLog: options.onLog,
    }),
    prepareCroppedImageVariant({
      inputFile: portraitSourceFile!,
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
  const landscapeSource = posters
    .filter((poster) => poster.width !== undefined && poster.height !== undefined && poster.width > poster.height)
    .sort((left, right) => (
      Math.abs((left.width! / left.height!) - (16 / 9))
      - Math.abs((right.width! / right.height!) - (16 / 9))
    ))[0];
  const portraitSource = posters
    .filter((poster) => (
    poster.width !== undefined && poster.height !== undefined && poster.height > poster.width
    ))
    .sort((left, right) => (
      Math.abs((left.width! / left.height!) - (3 / 4))
      - Math.abs((right.width! / right.height!) - (3 / 4))
    ))[0];
  const outputDir = path.join(
    options.assetDownloadDir ?? path.resolve(process.cwd(), ".drama-runs/baidu-drama/assets"),
    "poster-upload",
  );
  const onResizeLog = (message: string) =>
    log(options, `[baidu-drama] ${message}`, undefined, "resources");
  const { landscape, portrait } = await prepareBaiduDramaCoverVariants({
    sourceFile: coverSource.file,
    landscapeSourceFile: landscapeSource?.file,
    portraitSourceFile: portraitSource?.file,
    title: task.playlet.title,
    outputDir,
    aiCacheDir: path.join(
      options.assetDownloadDir ?? path.resolve(process.cwd(), ".drama-runs/baidu-drama/assets"),
      "ai-cover-cache",
    ),
    aiImageModel: options.aiImageModel,
    createAiClient: options.createAiClient,
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
