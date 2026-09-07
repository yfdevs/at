import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { prepareContainedImageVariant } from "@drama/drama-media-assets";
import { log } from "./logger.js";
import type { ClaimedTencentHuolongDramaTask, TencentHuolongRuntimeOptions } from "./types.js";

export type TencentHuolongCoverFiles = {
  landscape: string;
  portrait: string;
  ranking: string;
  card: string;
};

const targets = {
  landscape: { width: 1920, height: 1080, label: "横版封面", title: true },
  portrait: { width: 770, height: 1080, label: "竖版封面", title: true },
  ranking: { width: 2450, height: 800, label: "榜单封面", title: false },
  card: { width: 1500, height: 1200, label: "横版卡片图", title: true },
} as const;

async function generateCover(
  kind: keyof typeof targets,
  sourceFile: string,
  task: ClaimedTencentHuolongDramaTask,
  options: TencentHuolongRuntimeOptions,
) {
  if (!options.aiClient) throw new Error("DRAMA_AI_API_KEY_REQUIRED");
  if (!options.aiImageModel?.trim()) throw new Error("DRAMA_AI_IMAGE_MODEL_REQUIRED");
  if (!options.assetDownloadDir?.trim()) throw new Error("TENCENT_HUOLONG_DRAMA_ASSET_DIR_REQUIRED");
  const target = targets[kind];
  const source = await readFile(sourceFile);
  const cacheKey = createHash("sha256")
    .update(source)
    .update(options.aiImageModel)
    .update(kind)
    .update(task.playlet.title)
    .digest("hex").slice(0, 24);
  const outputDir = path.join(options.assetDownloadDir, "generated-covers", cacheKey);
  const output = path.join(outputDir, `${kind}-${target.width}x${target.height}.jpg`);
  if (await access(output).then(() => true, () => false)) return output;
  await mkdir(outputDir, { recursive: true });
  const temporary = path.join(outputDir, `.generated-${kind}-${process.pid}-${Date.now()}`);
  const titleRule = target.title
    ? `画面必须清晰、完整、准确地展示唯一中文剧名“${task.playlet.title}”，不得出现其他文字。`
    : "画面不得出现任何文字、字母、数字、标志、水印、二维码或伪界面。";
  try {
    const generated = await options.aiClient.generateImage({
      model: options.aiImageModel,
      referenceImages: [{ type: "file", path: sourceFile }],
      size: `${target.width}x${target.height}`,
      watermark: false,
      prompt: [
        `以参考封面中的人物身份、服饰、场景和整体美术风格为依据，重新构图生成腾讯火龙漫剧${target.label}。`,
        `目标成图比例和构图必须适配 ${target.width}×${target.height}，主体完整，重要人物位于安全区域。`,
        "不要添加平台标识、边框、技术参数、演员名、宣传语、集数或日期。",
        titleRule,
        `剧情简介：${task.playlet.summary}`,
      ].join("\n"),
    });
    const image = generated.images[0];
    if (!image?.data.length) throw new Error("TENCENT_HUOLONG_DRAMA_AI_COVER_EMPTY");
    await writeFile(temporary, Buffer.from(image.data));
    await prepareContainedImageVariant({
      inputFile: temporary,
      outputFile: output,
      width: target.width,
      height: target.height,
      maxFileBytes: 9_500_000,
      jpegQuality: 92,
      onLog: (message) => log(options, message),
    });
    return output;
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function prepareTencentHuolongCovers(
  sourceFile: string,
  task: ClaimedTencentHuolongDramaTask,
  options: TencentHuolongRuntimeOptions,
): Promise<TencentHuolongCoverFiles> {
  const landscape = await generateCover("landscape", sourceFile, task, options);
  const portrait = await generateCover("portrait", sourceFile, task, options);
  const ranking = await generateCover("ranking", sourceFile, task, options);
  const card = await generateCover("card", sourceFile, task, options);
  return { landscape, portrait, ranking, card };
}
