import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeImagesAsJson } from "@drama/ai";
import {
  prepareExtractedImageVariant,
  readImageDimensions,
  type ImageCropRegion,
  type ImageDimensions,
} from "@drama/drama-media-assets";
import { z } from "zod";
import type {
  KuaishouDramaPublishVariant,
  KuaishouDramaRuntimeOptions,
  KuaishouDramaTaskConfig,
} from "./types.js";

const promptVersion = "kuaishou-ad-cover-v3";
const normalizedCoordinateMaximum = 1000;
const minimumConfidence = 0.7;
const minimumSubjectCoverage = 0.3;
const outputWidth = 900;
const outputHeight = 1200;
const outputMaxFileBytes = 1_900_000;

const normalizedCoordinateSchema = z.coerce.number().finite().min(0).max(1000);
const normalizedBoxSchema = z.object({
  x1: normalizedCoordinateSchema,
  y1: normalizedCoordinateSchema,
  x2: normalizedCoordinateSchema,
  y2: normalizedCoordinateSchema,
}).refine((box) => box.x2 > box.x1 && box.y2 > box.y1, {
  message: "x2/y2 must be greater than x1/y1",
});

export const kuaishouAdCoverAnalysisSchema = z.object({
  titleRegions: z.array(normalizedBoxSchema).max(20),
  subjectBox: normalizedBoxSchema,
  recommendedCrop: normalizedBoxSchema,
  confidence: z.coerce.number().finite().min(0).max(1),
  detectedTitleText: z.string().trim().max(200).optional(),
  subjectDescription: z.string().trim().max(500).optional(),
});

export type KuaishouAdCoverAnalysis = z.infer<typeof kuaishouAdCoverAnalysisSchema>;
type NormalizedBox = KuaishouAdCoverAnalysis["subjectBox"];
type PixelBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function boxWidth(box: PixelBox) {
  return box.right - box.left;
}

function boxHeight(box: PixelBox) {
  return box.bottom - box.top;
}

function boxArea(box: PixelBox) {
  return Math.max(0, boxWidth(box)) * Math.max(0, boxHeight(box));
}

function intersectionArea(left: PixelBox, right: PixelBox) {
  return Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left)) *
    Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
}

function normalizedBoxToPixels(box: NormalizedBox, image: ImageDimensions): PixelBox {
  const left = clamp(
    Math.floor(box.x1 / normalizedCoordinateMaximum * image.width),
    0,
    image.width - 1,
  );
  const top = clamp(
    Math.floor(box.y1 / normalizedCoordinateMaximum * image.height),
    0,
    image.height - 1,
  );
  const right = clamp(
    Math.ceil(box.x2 / normalizedCoordinateMaximum * image.width),
    left + 1,
    image.width,
  );
  const bottom = clamp(
    Math.ceil(box.y2 / normalizedCoordinateMaximum * image.height),
    top + 1,
    image.height,
  );
  return { left, top, right, bottom };
}

function largestTargetCropInside(container: PixelBox, subject: PixelBox): PixelBox | undefined {
  const targetRatio = outputWidth / outputHeight;
  const containerWidth = boxWidth(container);
  const containerHeight = boxHeight(container);
  if (containerWidth < 3 || containerHeight < 4) return undefined;

  const unit = containerWidth / containerHeight >= targetRatio
    ? Math.floor(containerHeight / 4)
    : Math.floor(containerWidth / 3);
  if (unit <= 0) return undefined;
  const cropWidth = unit * 3;
  const cropHeight = unit * 4;
  const subjectCenterX = (subject.left + subject.right) / 2;
  const subjectCenterY = (subject.top + subject.bottom) / 2;
  const left = clamp(
    Math.round(subjectCenterX - cropWidth / 2),
    container.left,
    container.right - cropWidth,
  );
  const top = clamp(
    Math.round(subjectCenterY - cropHeight / 2),
    container.top,
    container.bottom - cropHeight,
  );
  return { left, top, right: left + cropWidth, bottom: top + cropHeight };
}

/** Converts the semantic crop to the exact 3:4 crop uploaded to Kuaishou. */
export function calculateKuaishouAdCoverCrop(
  analysis: KuaishouAdCoverAnalysis,
  image: ImageDimensions,
): ImageCropRegion {
  if (analysis.confidence < minimumConfidence) {
    throw new Error(
      `KUAISHOU_AD_COVER_AI_LOW_CONFIDENCE: ` +
        `confidence=${analysis.confidence} minimum=${minimumConfidence}`,
    );
  }

  const recommendation = normalizedBoxToPixels(analysis.recommendedCrop, image);
  const subject = normalizedBoxToPixels(analysis.subjectBox, image);
  const imageBox: PixelBox = { left: 0, top: 0, right: image.width, bottom: image.height };
  const titleBoxes = analysis.titleRegions.map((region) => normalizedBoxToPixels(region, image));
  const safeContainers: PixelBox[] = [recommendation, imageBox];
  const textGap = Math.max(8, Math.round(image.height * 0.05));
  for (const title of titleBoxes) {
    safeContainers.push(
      { left: 0, top: 0, right: image.width, bottom: Math.max(0, title.top - textGap) },
      { left: 0, top: Math.min(image.height, title.bottom + textGap), right: image.width, bottom: image.height },
      { left: 0, top: 0, right: Math.max(0, title.left - textGap), bottom: image.height },
      { left: Math.min(image.width, title.right + textGap), top: 0, right: image.width, bottom: image.height },
    );
  }

  const candidates = safeContainers
    .map((container) => largestTargetCropInside(container, subject))
    .filter((crop): crop is PixelBox => Boolean(crop))
    .map((crop) => {
      const subjectCoverage = intersectionArea(crop, subject) / Math.max(1, boxArea(subject));
      const maximumTitleCoverage = titleBoxes.reduce((maximum, title) => Math.max(
        maximum,
        intersectionArea(crop, title) / Math.max(1, boxArea(title)),
      ), 0);
      return { crop, subjectCoverage, maximumTitleCoverage };
    })
    .filter((candidate) => candidate.maximumTitleCoverage <= 0.08)
    .sort((left, right) =>
      right.subjectCoverage - left.subjectCoverage || boxArea(right.crop) - boxArea(left.crop));
  const selected = candidates[0];
  if (!selected) {
    throw new Error("KUAISHOU_AD_COVER_CROP_INVALID: title-free-crop-not-found");
  }
  const cropWidth = boxWidth(selected.crop);
  const cropHeight = boxHeight(selected.crop);
  if (cropWidth < 64 || cropHeight < 64) {
    throw new Error(
      `KUAISHOU_AD_COVER_CROP_INVALID: crop-too-small=${cropWidth}x${cropHeight}`,
    );
  }
  if (selected.subjectCoverage < minimumSubjectCoverage) {
    throw new Error(
      `KUAISHOU_AD_COVER_CROP_INVALID: ` +
        `subject-coverage=${selected.subjectCoverage.toFixed(3)} ` +
        `minimum=${minimumSubjectCoverage}`,
    );
  }

  return {
    left: selected.crop.left,
    top: selected.crop.top,
    width: cropWidth,
    height: cropHeight,
  };
}

function analysisPrompt(title: string, previousFailure?: string) {
  const retryInstruction = previousFailure
    ? `\n上一次结果未通过程序校验，原因：${previousFailure.slice(0, 300)}。请修正坐标后重新返回。`
    : "";
  return `你是短剧广告封面视觉分析器。请分析图片并为快手“观看广告解锁”版本定位一个新的竖版封面裁剪区域。\n\n` +
    `已知短剧剧名：${JSON.stringify(title)}\n` +
    `目标：保留最重要的人物、面部或核心视觉主体，同时完整避开剧名文字区域以及角标、宣传语等干扰文字。\n` +
    `裁剪要求：\n` +
    `1. titleRegions 返回图片中全部剧名文字和干扰文字的外接矩形。\n` +
    `2. subjectBox 只返回最终封面最应该保留的核心人物或主体，不要把所有次要人物合并成一个过大的矩形。\n` +
    `3. recommendedCrop 返回建议裁剪矩形，宽高比必须接近 3:4，包含核心主体并预留约 10% 安全边距。\n` +
    `4. recommendedCrop 不得与任何 titleRegions 相交；无法保留全部人物时优先保留最主要人物的面部和上半身。\n` +
    `5. 所有坐标基于图片左上角，使用 0 到 1000 的归一化整数坐标。\n` +
    `6. confidence 是 0 到 1 的数字。\n\n` +
    `只返回一个 JSON 对象，不要 Markdown、解释或代码块，格式为：\n` +
    `{"titleRegions":[{"x1":0,"y1":0,"x2":100,"y2":100}],` +
    `"subjectBox":{"x1":100,"y1":100,"x2":700,"y2":900},` +
    `"recommendedCrop":{"x1":100,"y1":50,"x2":700,"y2":850},` +
    `"confidence":0.9,"detectedTitleText":"识别到的剧名",` +
    `"subjectDescription":"核心主体描述"}` + retryInstruction;
}

async function cacheKeyForCover(
  sourceFile: string,
  title: string,
  modelId: string | undefined,
) {
  const source = await readFile(sourceFile);
  return createHash("sha256")
    .update(source)
    .update("\0")
    .update(title)
    .update("\0")
    .update(modelId?.trim() || "runtime-model")
    .update("\0")
    .update(`${promptVersion}:${outputWidth}x${outputHeight}`)
    .digest("hex");
}

async function isUsableCachedCover(outputFile: string, metadataFile: string, cacheKey: string) {
  const [outputStat, metadata] = await Promise.all([
    stat(outputFile).catch(() => undefined),
    readFile(metadataFile, "utf8")
      .then((content) => JSON.parse(content) as { cacheKey?: unknown })
      .catch(() => undefined),
  ]);
  if (!outputStat?.isFile() || outputStat.size <= 0 || metadata?.cacheKey !== cacheKey) {
    return false;
  }
  const dimensions = await readImageDimensions(outputFile).catch(() => undefined);
  return dimensions?.width === outputWidth && dimensions.height === outputHeight;
}

export async function prepareKuaishouAdUnlockCover(
  task: KuaishouDramaTaskConfig,
  options: KuaishouDramaRuntimeOptions,
) {
  const sourceFile = task.localCoverFile?.trim();
  if (!sourceFile) throw new Error("KUAISHOU_DRAMA_LOCAL_COVER_FILE_REQUIRED");
  if (!options.aiClient) {
    task.localAdUnlockCoverFile = sourceFile;
    options.onLog?.(
      "[kuaishou-drama] AI configuration is unavailable; using the original cover for ad-unlock",
    );
    return sourceFile;
  }
  const outputRoot = options.assetDownloadDir?.trim();
  if (!outputRoot) throw new Error("KUAISHOU_AD_COVER_OUTPUT_DIR_REQUIRED");

  const cacheKey = await cacheKeyForCover(sourceFile, task.title, options.aiModelId);
  const cacheDir = path.join(outputRoot, "ai-cover");
  const outputFile = path.join(cacheDir, `${cacheKey}.jpg`);
  const metadataFile = path.join(cacheDir, `${cacheKey}.json`);
  await mkdir(cacheDir, { recursive: true });
  if (await isUsableCachedCover(outputFile, metadataFile, cacheKey)) {
    options.onLog?.(`[kuaishou-drama] ad cover AI cache hit: ${outputFile}`);
    task.localAdUnlockCoverFile = outputFile;
    return outputFile;
  }

  const imageDimensions = await readImageDimensions(sourceFile);
  const analysisAttempts = Math.max(
    1,
    Math.min(3, Math.floor(options.adCoverAiAnalysisAttempts ?? 2)),
  );
  let previousFailure: string | undefined;
  let selected:
    | {
        analysis: KuaishouAdCoverAnalysis;
        crop: ImageCropRegion;
        model: string;
        requestId?: string;
      }
    | undefined;
  for (let attempt = 1; attempt <= analysisAttempts; attempt += 1) {
    try {
      options.onLog?.(
        `[kuaishou-drama] analyzing ad cover with AI: attempt=${attempt}/${analysisAttempts}`,
      );
      const completion = await analyzeImagesAsJson(options.aiClient, {
        images: [{ type: "file", path: sourceFile, detail: "high" }],
        prompt: analysisPrompt(task.title, previousFailure),
        systemPrompt: "你只输出符合用户指定结构的 JSON 对象。",
        maxTokens: 1_400,
        temperature: 0,
      });
      const parsed = kuaishouAdCoverAnalysisSchema.safeParse(completion.data);
      if (!parsed.success) {
        throw new Error(
          `KUAISHOU_AD_COVER_AI_RESPONSE_INVALID: ` +
            parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
        );
      }
      options.onLog?.(
        `[kuaishou-drama] ad cover AI coordinates: ${JSON.stringify(parsed.data)}`,
      );
      selected = {
        analysis: parsed.data,
        crop: calculateKuaishouAdCoverCrop(parsed.data, imageDimensions),
        model: completion.model,
        requestId: completion.requestId,
      };
      break;
    } catch (error) {
      previousFailure = errorMessage(error);
      if (attempt >= analysisAttempts) {
        throw Object.assign(
          new Error(`KUAISHOU_AD_COVER_AI_ANALYSIS_FAILED: ${previousFailure}`),
          { cause: error },
        );
      }
      options.onLog?.(
        `[kuaishou-drama] ad cover AI result rejected, retrying: ${previousFailure}`,
      );
    }
  }
  if (!selected) throw new Error("KUAISHOU_AD_COVER_AI_ANALYSIS_FAILED");

  try {
    await prepareExtractedImageVariant({
      inputFile: sourceFile,
      outputFile,
      crop: selected.crop,
      width: outputWidth,
      height: outputHeight,
      jpegQuality: 92,
      maxFileBytes: outputMaxFileBytes,
      onLog: options.onLog,
    });
    await writeFile(metadataFile, JSON.stringify({
      cacheKey,
      promptVersion,
      sourceFile,
      sourceDimensions: imageDimensions,
      outputDimensions: { width: outputWidth, height: outputHeight },
      model: selected.model,
      requestId: selected.requestId,
      analysis: selected.analysis,
      crop: selected.crop,
      createdAt: new Date().toISOString(),
    }, null, 2));
  } catch (error) {
    throw Object.assign(
      new Error(`KUAISHOU_AD_COVER_PROCESS_FAILED: ${errorMessage(error)}`),
      { cause: error },
    );
  }

  task.localAdUnlockCoverFile = outputFile;
  options.onLog?.(
    `[kuaishou-drama] ad-unlock AI cover ready: ` +
      `confidence=${selected.analysis.confidence} crop=` +
      `${selected.crop.left},${selected.crop.top},${selected.crop.width},${selected.crop.height} ` +
      `file=${outputFile}`,
  );
  return outputFile;
}

export function resolveKuaishouVariantCoverFile(
  task: KuaishouDramaTaskConfig,
  variant: KuaishouDramaPublishVariant,
) {
  if (variant.kind === "ad-unlock") {
    const adCover = task.localAdUnlockCoverFile?.trim();
    if (adCover) return adCover;
  }
  const originalCover = task.localCoverFile?.trim();
  if (!originalCover) throw new Error("KUAISHOU_DRAMA_LOCAL_COVER_FILE_REQUIRED");
  return originalCover;
}
