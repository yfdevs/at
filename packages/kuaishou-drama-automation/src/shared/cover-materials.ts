import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { analyzeImagesAsJson } from "@drama/ai";
import {
  prepareContainedImageVariant,
  readImageDimensions,
  type LocalPosterImageFile,
} from "@drama/drama-media-assets";
import { z } from "zod";

import { log } from "../automation/browser-session.js";
import type {
  KuaishouDramaRuntimeOptions,
  KuaishouDramaTaskConfig,
} from "./types.js";

export const KUAISHOU_DRAMA_COVER_SIZE = {
  width: 2_208,
  height: 1_376,
} as const;

export const KUAISHOU_EPISODE_COVER_SIZE = {
  width: 1_792,
  height: 2_400,
} as const;

type KuaishouCoverKind = "drama" | "episode";

const promptVersion = "kuaishou-cover-counterpart-v3-text-safety";
const normalizationVersion = "kuaishou-cover-contain-v1";
const maximumFileBytes = 9_500_000;
const activeGenerations = new Map<string, Promise<string>>();

export const kuaishouGeneratedCoverValidationSchema = z.object({
  mainSubjectsComplete: z.boolean(),
  facesIntact: z.boolean(),
  titleTextExact: z.boolean(),
  titleInsideSafeArea: z.boolean(),
  unrelatedTextFree: z.boolean(),
  noWatermarkOrTechnicalOverlay: z.boolean(),
  noMirroringOrTiling: z.boolean(),
  referenceSimilarityConfidence: z.coerce.number().finite().min(0).max(1),
  detectedTitleText: z.string().trim().max(200).optional(),
  issues: z.array(z.string().trim().max(300)).max(20).default([]),
});

export type KuaishouGeneratedCoverValidation = z.infer<
  typeof kuaishouGeneratedCoverValidationSchema
>;

const coverDetails = {
  drama: {
    label: "短剧横版封面",
    ratioLabel: "414:258（约 1.605:1）横版",
    outputName: "kuaishou-drama-cover-2208x1376.jpg",
    target: KUAISHOU_DRAMA_COVER_SIZE,
  },
  episode: {
    label: "单集竖版封面",
    ratioLabel: "224:300（约 3:4）竖版",
    outputName: "kuaishou-episode-cover-1792x2400.jpg",
    target: KUAISHOU_EPISODE_COVER_SIZE,
  },
} as const;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function isPreparedCover(file: string, kind: KuaishouCoverKind) {
  const fileStat = await stat(file).catch(() => undefined);
  if (!fileStat?.isFile() || fileStat.size <= 0 || fileStat.size > maximumFileBytes) return false;
  const dimensions = await readImageDimensions(file).catch(() => undefined);
  const target = coverDetails[kind].target;
  return dimensions?.width === target.width && dimensions.height === target.height;
}

export function selectKuaishouCoverSources(posters: readonly LocalPosterImageFile[]) {
  const landscape = posters.find((poster) =>
    poster.width !== undefined && poster.height !== undefined && poster.width > poster.height
  );
  const portrait = posters.find((poster) =>
    poster.width !== undefined && poster.height !== undefined && poster.height > poster.width
  );
  return {
    landscape,
    portrait,
    fallback: portrait ?? landscape ?? posters[0],
  };
}

export function buildKuaishouCounterpartCoverPrompt(options: {
  kind: KuaishouCoverKind;
  title: string;
}) {
  const sourceKind = options.kind === "drama" ? "竖版" : "横版";
  const outputKind = options.kind === "drama" ? "横版" : "竖版";
  const composition = options.kind === "drama"
    ? "将竖版画面自然扩展到左右两侧，补全与原图一致的场景，必要时重新排布人物与剧名。"
    : "将横版画面重新排布为竖版，优先保留主要人物的面部、上半身、关键道具和完整剧名。";
  return [
    `根据参考${sourceKind}封面，将它改造成一张可直接发布的短剧${outputKind}成品封面。`,
    "保持原封面的核心人物、人物关系、面部特征、服饰、时代背景、色彩气质和作品辨识度。",
    composition,
    "不得简单拉伸、镜像、重复拼接、添加边框，不得裁断人脸、头部、主要人物或关键道具。",
    "所有主要人物和剧名放在画面中央区域，四周留出充足的纯场景背景，确保发布裁剪后仍能完整展示。",
    `剧名必须严格保持为“${options.title}”，不改字、不漏字、不重复；参考图中已有剧名时优先保留或准确重建。`,
    "最终成图只能出现一处上述剧名；除剧名外，严禁出现任何文字、字母、数字或类似文字的符号。",
    "尤其不得出现演员姓名、演员表、职员表、署名、字幕、副标题、宣传语、集数、日期、时间、画幅比例、分辨率、相机参数、标志、水印、角标、二维码、信息栏或伪界面。",
    "参考图若含剧名以外的文字，必须删除，不得复制、改写或补全；不要预留演员名或字幕排版区域。",
    "直接输出干净的成品海报，不要输出设计稿、模板、制作说明或界面预览。",
  ].join("\n");
}

function buildValidationRetryGuidance(validation: KuaishouGeneratedCoverValidation) {
  const guidance = new Set<string>();
  if (!validation.mainSubjectsComplete) {
    guidance.add("完整呈现所有主要人物和关键道具，不要让其被边缘裁断。");
  }
  if (!validation.facesIntact) {
    guidance.add("保持参考人物的面部特征，确保人脸自然、完整、无遮挡。");
  }
  if (!validation.titleTextExact) {
    guidance.add("只写一处准确剧名，逐字核对，不得改字、漏字或重复。");
  }
  if (!validation.titleInsideSafeArea) {
    guidance.add("把剧名移入中央区域，与画面边缘留出明显背景空间。");
  }
  if (!validation.unrelatedTextFree || !validation.noWatermarkOrTechnicalOverlay) {
    guidance.add("成品中除准确剧名外不要出现任何文字、符号、标记或界面装饰。");
  }
  if (!validation.noMirroringOrTiling) {
    guidance.add("自然延展场景，不要镜像、重复或拼贴背景。");
  }
  if (validation.referenceSimilarityConfidence < 0.75) {
    guidance.add("提高与参考图的人物、服饰、场景和整体气质一致性。");
  }
  return [...guidance].join("\n");
}

function validationFailure(validation: KuaishouGeneratedCoverValidation) {
  const failedChecks = [
    ["main-subjects-incomplete", validation.mainSubjectsComplete],
    ["faces-damaged", validation.facesIntact],
    ["title-text-inexact", validation.titleTextExact],
    ["title-outside-safe-area", validation.titleInsideSafeArea],
    ["unrelated-text-detected", validation.unrelatedTextFree],
    ["watermark-or-technical-overlay", validation.noWatermarkOrTechnicalOverlay],
    ["mirroring-or-tiling", validation.noMirroringOrTiling],
    ["reference-similarity-low", validation.referenceSimilarityConfidence >= 0.75],
  ].filter(([, passed]) => !passed).map(([name]) => name);
  return [...failedChecks, ...validation.issues].join("; ");
}

async function validateGeneratedCover(options: {
  sourceFile: string;
  generatedFile: string;
  kind: KuaishouCoverKind;
  title: string;
  runtime: KuaishouDramaRuntimeOptions;
}) {
  const detail = coverDetails[options.kind];
  const completion = await analyzeImagesAsJson(options.runtime.aiClient!, {
    images: [
      { type: "file", path: options.sourceFile, detail: "high" },
      { type: "file", path: options.generatedFile, detail: "high" },
    ],
    prompt: [
      "你是快手短剧封面质检员。第 1 张是参考原图，第 2 张是待验收的生成图。",
      `待验收图用于${detail.label}，目标比例为${detail.ratioLabel}。`,
      `准确剧名是：${options.title}。`,
      "请逐项判断：主要人物是否完整；人脸是否无畸变和遮挡；剧名是否逐字准确且与四周边界至少保持约 5% 安全距离。",
      "除准确剧名外，是否存在随机文字、坐标、尺寸、时间戳、相机参数、取景框、水印、二维码、平台标识等伪界面元素。",
      "检查背景是否有明显镜像、重复拼接或边框，以及生成图与参考图的人物和作品辨识度是否一致。",
      "只返回 JSON 对象，不要 Markdown 或解释。布尔字段必须严格填 true/false。",
      "格式：" + JSON.stringify({
        mainSubjectsComplete: true,
        facesIntact: true,
        titleTextExact: true,
        titleInsideSafeArea: true,
        unrelatedTextFree: true,
        noWatermarkOrTechnicalOverlay: true,
        noMirroringOrTiling: true,
        referenceSimilarityConfidence: 0.95,
        detectedTitleText: options.title,
        issues: [],
      }),
    ].join("\n"),
    systemPrompt: "你只输出符合用户指定结构的 JSON 对象。",
    maxTokens: 900,
    temperature: 0,
  });
  const validation = kuaishouGeneratedCoverValidationSchema.parse(completion.data);
  return {
    validation,
    failure: validationFailure(validation),
    model: completion.model,
    requestId: completion.requestId,
  };
}

async function normalizedCoverCacheKey(sourceFile: string, kind: KuaishouCoverKind) {
  return createHash("sha256")
    .update(await readFile(sourceFile))
    .update(kind)
    .update(normalizationVersion)
    .digest("hex")
    .slice(0, 24);
}

async function prepareExistingCover(
  sourceFile: string,
  kind: KuaishouCoverKind,
  options: KuaishouDramaRuntimeOptions,
) {
  const outputRoot = options.assetDownloadDir?.trim();
  if (!outputRoot) throw new Error("KUAISHOU_DRAMA_COVER_OUTPUT_DIR_REQUIRED");
  const cacheKey = await normalizedCoverCacheKey(sourceFile, kind);
  const output = path.join(
    outputRoot,
    "prepared-covers",
    cacheKey,
    coverDetails[kind].outputName,
  );
  if (await isPreparedCover(output, kind)) {
    log(options, `[kuaishou-drama] reused prepared ${kind} cover: ${output}`);
    return output;
  }
  const target = coverDetails[kind].target;
  await prepareContainedImageVariant({
    inputFile: sourceFile,
    outputFile: output,
    ...target,
    jpegQuality: 92,
    maxFileBytes: maximumFileBytes,
    onLog: (message) => log(options, message),
  });
  return output;
}

async function generatedCoverCacheKey(options: {
  sourceFile: string;
  kind: KuaishouCoverKind;
  title: string;
  model: string;
  prompt: string;
}) {
  return createHash("sha256")
    .update(await readFile(options.sourceFile))
    .update(options.kind)
    .update(options.title)
    .update(options.model)
    .update(promptVersion)
    .update(options.prompt)
    .digest("hex")
    .slice(0, 24);
}

async function isUsableGeneratedCover(options: {
  output: string;
  metadataFile: string;
  cacheKey: string;
  kind: KuaishouCoverKind;
}) {
  if (!await isPreparedCover(options.output, options.kind)) return false;
  const metadata = await readFile(options.metadataFile, "utf8")
    .then((content) => JSON.parse(content) as {
      cacheKey?: unknown;
      validation?: { passed?: unknown };
    })
    .catch(() => undefined);
  return metadata?.cacheKey === options.cacheKey && metadata.validation?.passed === true;
}

async function generateMissingCover(options: {
  sourceFile: string;
  sourceKind: "landscape" | "portrait" | "generic";
  kind: KuaishouCoverKind;
  title: string;
  runtime: KuaishouDramaRuntimeOptions;
}) {
  const outputRoot = options.runtime.assetDownloadDir?.trim();
  if (!outputRoot) throw new Error("KUAISHOU_DRAMA_COVER_OUTPUT_DIR_REQUIRED");
  if (!options.runtime.aiClient) throw new Error("DRAMA_AI_API_KEY_REQUIRED");
  const model = options.runtime.aiImageModel?.trim();
  if (!model) throw new Error("DRAMA_AI_IMAGE_MODEL_REQUIRED");

  const prompt = buildKuaishouCounterpartCoverPrompt({
    kind: options.kind,
    title: options.title,
  });
  const cacheKey = await generatedCoverCacheKey({
    sourceFile: options.sourceFile,
    kind: options.kind,
    title: options.title,
    model,
    prompt,
  });
  const cacheDir = path.join(outputRoot, "ai-cover", cacheKey);
  const output = path.join(cacheDir, coverDetails[options.kind].outputName);
  const metadataFile = path.join(cacheDir, "generation.json");
  if (await isUsableGeneratedCover({ output, metadataFile, cacheKey, kind: options.kind })) {
    log(options.runtime, `[kuaishou-drama] reused AI ${options.kind} cover cache: ${output}`);
    return output;
  }

  const active = activeGenerations.get(cacheKey);
  if (active) return active;
  const operation = (async () => {
    if (await isUsableGeneratedCover({ output, metadataFile, cacheKey, kind: options.kind })) {
      return output;
    }
    await mkdir(cacheDir, { recursive: true });
    const target = coverDetails[options.kind].target;
    const attempts = Math.max(
      1,
      Math.min(3, Math.floor(options.runtime.coverAiGenerationAttempts ?? 3)),
    );
    let lastError: unknown;
    let previousFailure: string | undefined;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let retryGuidance: string | undefined;
      const temporarySource = path.join(
        cacheDir,
        `.generated-${options.kind}-${process.pid}-${Date.now()}-${attempt}.image`,
      );
      try {
        log(
          options.runtime,
          `[kuaishou-drama] generating AI ${options.kind} cover: ` +
            `source=${options.sourceKind} attempt=${attempt}/${attempts} model=${model}`,
        );
        const requestPrompt = previousFailure
          ? `${prompt}\n\n上一张生成图未通过自动验收，原因：${previousFailure.slice(0, 600)}。请重新生成并逐项修正。`
          : prompt;
        const result = await options.runtime.aiClient!.generateImage({
          model,
          prompt: requestPrompt,
          referenceImages: [{ type: "file", path: options.sourceFile }],
          size: `${target.width}x${target.height}`,
          watermark: false,
        });
        const generated = result.images[0];
        if (!generated?.data.length) throw new Error("KUAISHOU_DRAMA_AI_COVER_RESPONSE_MISSING");
        await writeFile(temporarySource, Buffer.from(generated.data));
        await prepareContainedImageVariant({
          inputFile: temporarySource,
          outputFile: output,
          ...target,
          jpegQuality: 92,
          maxFileBytes: maximumFileBytes,
          onLog: (message) => log(options.runtime, message),
        });
        const validated = await validateGeneratedCover({
          sourceFile: options.sourceFile,
          generatedFile: output,
          kind: options.kind,
          title: options.title,
          runtime: options.runtime,
        });
        if (validated.failure) {
          retryGuidance = buildValidationRetryGuidance(validated.validation);
          throw new Error(`KUAISHOU_DRAMA_AI_COVER_VALIDATION_FAILED: ${validated.failure}`);
        }
        await writeFile(metadataFile, JSON.stringify({
          cacheKey,
          promptVersion,
          sourceFile: options.sourceFile,
          sourceKind: options.sourceKind,
          kind: options.kind,
          title: options.title,
          model: result.model,
          requestId: result.requestId,
          target,
          prompt: requestPrompt,
          validation: {
            passed: true,
            ...validated.validation,
            model: validated.model,
            requestId: validated.requestId,
          },
          createdAt: new Date().toISOString(),
        }, null, 2));
        log(options.runtime, `[kuaishou-drama] AI ${options.kind} cover ready: ${output}`);
        return output;
      } catch (error) {
        lastError = error;
        previousFailure = retryGuidance ?? "重新生成一张干净、完整并与参考图一致的成品封面。";
        await rm(output, { force: true }).catch(() => undefined);
        log(
          options.runtime,
          `[kuaishou-drama] AI ${options.kind} cover attempt failed: ` +
            `${attempt}/${attempts} ${errorMessage(error)}`,
        );
      } finally {
        await rm(temporarySource, { force: true }).catch(() => undefined);
      }
    }
    throw Object.assign(
      new Error(
        `KUAISHOU_DRAMA_AI_COVER_GENERATION_FAILED: ${options.kind}: ` +
          errorMessage(lastError),
      ),
      { cause: lastError },
    );
  })().finally(() => {
    activeGenerations.delete(cacheKey);
  });
  activeGenerations.set(cacheKey, operation);
  return operation;
}

export async function prepareKuaishouDramaCoverFiles(
  task: KuaishouDramaTaskConfig,
  posters: readonly LocalPosterImageFile[],
  options: KuaishouDramaRuntimeOptions,
) {
  const selected = selectKuaishouCoverSources(posters);
  if (!selected.fallback) throw new Error("KUAISHOU_DRAMA_COVER_SOURCE_REQUIRED");

  const dramaCoverPromise = selected.landscape
    ? prepareExistingCover(selected.landscape.file, "drama", options)
    : generateMissingCover({
        sourceFile: selected.portrait?.file ?? selected.fallback.file,
        sourceKind: selected.portrait ? "portrait" : "generic",
        kind: "drama",
        title: task.title,
        runtime: options,
      });
  const episodeCoverPromise = selected.portrait
    ? prepareExistingCover(selected.portrait.file, "episode", options)
    : generateMissingCover({
        sourceFile: selected.landscape?.file ?? selected.fallback.file,
        sourceKind: selected.landscape ? "landscape" : "generic",
        kind: "episode",
        title: task.title,
        runtime: options,
      });
  const [dramaCover, episodeCover] = await Promise.all([
    dramaCoverPromise,
    episodeCoverPromise,
  ]);

  task.localCoverFile = dramaCover;
  task.localEpisodeCoverFile = episodeCover;
  log(
    options,
    `[kuaishou-drama] unified cover files ready: drama=${dramaCover} episode=${episodeCover}`,
  );
  return {
    dramaCover,
    episodeCover,
    landscapeSource: selected.landscape?.file,
    portraitSource: selected.portrait?.file,
  };
}

export function resolveKuaishouDramaCoverFile(task: KuaishouDramaTaskConfig) {
  const file = task.localCoverFile?.trim();
  if (!file) throw new Error("KUAISHOU_DRAMA_LOCAL_COVER_FILE_REQUIRED");
  return file;
}

export function resolveKuaishouEpisodeCoverFile(task: KuaishouDramaTaskConfig) {
  const file = task.localEpisodeCoverFile?.trim();
  if (!file) throw new Error("KUAISHOU_DRAMA_LOCAL_EPISODE_COVER_FILE_REQUIRED");
  return file;
}
