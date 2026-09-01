import { createHash } from "node:crypto";
import { access, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  listLocalPosterImages,
  validateLocalEpisodeVideos,
} from "@drama/drama-media-assets";
import sharp from "sharp";

import { resolveIqiyiAsset } from "../automation/remote-assets.js";
import { log } from "./logger.js";
import type {
  ClaimedIqiyiDramaTask,
  IqiyiDramaRuntimeOptions,
  IqiyiDramaTaskPayload,
} from "./types.js";

const landscapePromptVersion = "iqiyi-landscape-v3-ai-title-art";
const iqiyiCoverMaximumBytes = 4_900_000;
const iqiyiProofMaximumBytes = 20 * 1024 * 1024;

function iqiyiTitleArtDirection(playlet: IqiyiDramaTaskPayload) {
  const genreText = [
    playlet.title,
    playlet.summary,
    playlet.primaryCategory,
    ...playlet.secondaryCategories,
  ].filter(Boolean).join(" ");

  if (/海|鲛|美人鱼|渔|赶海|龙宫|水下|海洋/u.test(genreText)) {
    return "海洋奇幻商业海报艺术字：青蓝到银白的通透渐变，深海蓝立体描边，柔和水光外发光和少量浪花纹理；笔画有流动感但清晰易读，与海面、潮汐或水下光影自然融合。";
  }
  if (/古装|宫廷|皇|帝|王妃|侯府|仙侠|武侠|江湖|修仙/u.test(genreText)) {
    return "古装传奇商业海报艺术字：有力量的中文书法展示体，金色或朱砂渐变，墨迹飞白、烫金边缘、厚重暗色描边和克制的光晕，具有影视主视觉气势。";
  }
  if (/悬疑|复仇|谜|罪|凶|诡|惊悚|探案|秘密/u.test(genreText)) {
    return "悬疑影视海报艺术字：锐利凝练的中文标题字形，冷白或暗金主体，深色粗描边、局部裂纹和红色微光，营造紧张感但必须保持每个汉字清晰。";
  }
  if (/甜宠|爱情|恋爱|婚|总裁|萌宝|心动|青春/u.test(genreText)) {
    return "情感甜宠商业海报艺术字：优雅流畅的中文展示字形，粉金或暖白渐变，细腻高光、柔和投影和轻盈装饰笔触，浪漫精致但不使用普通默认字体。";
  }
  if (/都市|逆袭|重生|豪门|职场|商战|财富/u.test(genreText)) {
    return "都市逆袭商业海报艺术字：现代有冲击力的中文展示体，金属金或亮白渐变，深色立体挤压、清晰投影和电影级高光，突出力量感与高级感。";
  }
  if (playlet.dramaType === "comic-drama" || /漫剧|动漫|AI 2D|AI 3D|动态漫|沙雕漫/u.test(genreText)) {
    return "高品质漫剧主视觉艺术字：有动势的粗体中文标题设计，鲜明渐变、双层描边、立体投影和适量能量光效，像专业漫画宣传海报标题而不是系统默认文字。";
  }
  return "电影级中文商业海报艺术字：根据画面主色设计高对比渐变，使用双层描边、立体厚度、投影和克制的环境光效；字形有专门设计感，绝不使用普通默认字体或无效果纯色文字。";
}

export function buildIqiyiLandscapeCoverPrompt(playlet: IqiyiDramaTaskPayload) {
  const contentType = playlet.dramaType === "comic-drama" ? "漫剧" : "短剧";
  return [
    `根据参考竖版封面，为爱奇艺${contentType}生成一张 16:9 横版商业宣传海报。`,
    "保持原封面的核心人物、人物关系、服饰、时代背景、色彩气质和作品辨识度。",
    "将竖版画面自然扩展到左右两侧，补全真实一致的场景，不要简单拉伸、镜像、拼接或加边框。",
    "主体位于安全区域，人物面部和关键道具完整清晰，适合 1920x1080 展示。",
    "【剧名文字是必须完成的主视觉元素】必须由图片生成模型直接在海报画面中绘制完整中文剧名，不留空白标题区，不交给后期添加。",
    `画面中唯一允许出现的主标题文字是：“${playlet.title}”。必须严格逐字使用该中文原文，不改字、不漏字、不增加字、不使用拼音或英文替代。`,
    "把剧名设计成专业影视海报的核心艺术字或标题标志，占据明确的视觉层级；禁止使用普通默认字体、办公字体、无描边纯色字或像界面文本一样平铺。",
    `本剧字效设计方向：${iqiyiTitleArtDirection(playlet)}`,
    "艺术字必须包含与题材协调的字形设计、渐变或材质、清晰描边、立体层次、投影或环境光效，并与场景光线和画面元素自然融合。",
    "长剧名可以合理分成 2 至 3 行并调整字号，但文字顺序必须保持不变，所有汉字必须完整、醒目、清晰可辨；不能遮挡人物面部和关键道具。",
    "参考图已有片名时，应以这里提供的准确剧名原文重新设计字效和排版；最终画面只保留一次完整剧名，删除错误、重复、残缺或普通样式的旧标题。",
    "不要新增平台标志、品牌标志、水印、角标、二维码、副标题、宣传语或任何其他无关文字。",
    `剧名原文：${playlet.title}`,
    `剧情与题材参考：${playlet.summary}`,
  ].join("\n");
}

function materialRoot(options: IqiyiDramaRuntimeOptions) {
  const root = options.localMaterialRoot?.trim();
  if (!root) throw new Error("请先配置爱奇艺本地素材根目录。");
  return root;
}

async function assertReadable(file: string, label: string) {
  await access(file).catch(() => {
    throw new Error(`[iqiyi-material-invalid] ${label}不存在或不可读取：${file}`);
  });
  return file;
}

async function writeJpegWithinLimit(
  input: string | Buffer,
  output: string,
  width: number | undefined,
  height: number | undefined,
  maximumBytes = iqiyiCoverMaximumBytes,
) {
  let quality = 92;
  let buffer = await sharp(input)
    .rotate()
    .resize(width, height, width && height ? { fit: "cover", position: "attention" } : undefined)
    .jpeg({ chromaSubsampling: "4:4:4", mozjpeg: true, quality })
    .toBuffer();
  while (buffer.length > maximumBytes && quality > 66) {
    quality -= 6;
    buffer = await sharp(input)
      .rotate()
      .resize(width, height, width && height ? { fit: "cover", position: "attention" } : undefined)
      .jpeg({ chromaSubsampling: "4:2:0", mozjpeg: true, quality })
      .toBuffer();
  }
  if (buffer.length > maximumBytes) {
    throw new Error(`[iqiyi-material-invalid] 图片压缩后仍超过 ${maximumBytes} 字节：${output}`);
  }
  await sharp(buffer).toFile(output);
  return output;
}

async function prepareProofFile(
  file: string,
  index: number,
  taskDir: string,
  proofType: "production-proof" | "license-proof",
) {
  const label = proofType === "production-proof" ? "知识产权声明文件" : "版权证明文件";
  await assertReadable(file, label);
  const extension = path.extname(file).toLowerCase();
  if (extension === ".pdf" || extension === ".jpg" || extension === ".jpeg" || extension === ".png") {
    const info = await stat(file);
    if (info.size > iqiyiProofMaximumBytes) {
      throw new Error(`[iqiyi-material-invalid] ${label}超过 20MB：${file}`);
    }
    return file;
  }
  if (extension === ".bmp" || extension === ".webp") {
    return writeJpegWithinLimit(
      file,
      path.join(taskDir, `iqiyi-${proofType}-${index + 1}.jpg`),
      undefined,
      undefined,
      iqiyiProofMaximumBytes - 100_000,
    );
  }
  throw new Error(`[iqiyi-material-invalid] ${label}仅支持 JPG、PNG 或 PDF：${file}`);
}

async function prepareProofReferences(
  references: string[],
  taskDir: string,
  proofType: "production-proof" | "license-proof",
  options: IqiyiDramaRuntimeOptions,
) {
  const label = proofType === "production-proof" ? "知识产权声明文件" : "版权证明文件";
  if (references.length === 0) {
    throw new Error(`[copyright-proof-invalid] ${label}至少需要上传 1 个文件。`);
  }
  if (references.length > 20) {
    throw new Error(`[iqiyi-material-invalid] ${label}最多上传 20 个文件，实际 ${references.length} 个。`);
  }
  const resolved = await Promise.all(
    references.map((reference, index) =>
      resolveIqiyiAsset(reference, options, `${proofType}-${index + 1}`)
    ),
  );
  return Promise.all(
    resolved.map((file, index) => prepareProofFile(file, index, taskDir, proofType)),
  );
}

async function generateLandscapeCover(
  verticalCover: string,
  task: ClaimedIqiyiDramaTask,
  options: IqiyiDramaRuntimeOptions,
) {
  if (!options.aiClient) throw new Error("DRAMA_AI_API_KEY_REQUIRED");
  const model = options.aiImageModel?.trim();
  if (!model) throw new Error("DRAMA_AI_IMAGE_MODEL_REQUIRED");
  if (!options.assetDownloadDir) throw new Error("爱奇艺素材下载目录未配置。");

  const prompt = buildIqiyiLandscapeCoverPrompt(task.playlet);
  const source = await readFile(verticalCover);
  const cacheKey = createHash("sha256")
    .update(source)
    .update(model)
    .update(landscapePromptVersion)
    .update(prompt)
    .digest("hex")
    .slice(0, 24);
  const outputDir = path.join(options.assetDownloadDir, "ai-landscape-covers", cacheKey);
  const output = path.join(outputDir, "iqiyi-landscape-1920x1080.jpg");
  await mkdir(outputDir, { recursive: true });
  if (await access(output).then(() => true, () => false)) {
    log(options, `[iqiyi-drama] reused AI landscape cover cache: ${output}`);
    return output;
  }

  log(options, `[iqiyi-drama] generating landscape cover with AI model=${model}`);
  const result = await options.aiClient.generateImage({
    model,
    prompt,
    referenceImages: [{ type: "file", path: verticalCover }],
    size: "2560x1440",
    watermark: false,
  });
  const generated = result.images[0];
  if (!generated) throw new Error("DRAMA_AI_IMAGE_RESPONSE_MISSING");
  await writeJpegWithinLimit(
    Buffer.from(generated.data),
    output,
    1920,
    1080,
    iqiyiCoverMaximumBytes,
  );
  log(options, `[iqiyi-drama] AI landscape cover ready: ${output}`);
  return output;
}

export async function prepareIqiyiMaterials(
  task: ClaimedIqiyiDramaTask,
  options: IqiyiDramaRuntimeOptions,
) {
  const root = materialRoot(options);
  const resourceName = task.originalTitle.trim();
  if (!resourceName) throw new Error("IQIYI_DRAMA_ORIGINAL_TITLE_REQUIRED");
  if (!options.assetDownloadDir) throw new Error("爱奇艺素材下载目录未配置。");

  const taskDir = path.join(options.assetDownloadDir, "prepared", String(task.accountTaskId));
  await mkdir(taskDir, { recursive: true });
  if (task.playlet.dramaType === "comic-drama") {
    await validateLocalEpisodeVideos({
      localEpisodeVideoRoot: root,
      resourceName,
      episodeCount: task.playlet.episodeCount,
    });
    log(options, `[iqiyi-drama] validated ${task.playlet.episodeCount} local episode videos`);
  }
  const posters = await listLocalPosterImages({
    root,
    resourceName,
    includeAllMatches: true,
  });
  const localVertical = posters.find((poster) =>
    poster.width !== undefined && poster.height !== undefined && poster.height > poster.width
  ) ?? posters[0];
  const verticalSource = task.playlet.verticalCoverFile
    ? await resolveIqiyiAsset(task.playlet.verticalCoverFile, options, "vertical-cover")
    : localVertical?.file;
  if (!verticalSource) {
    throw new Error(
      `[poster-material-invalid] 未找到爱奇艺竖版封面；扫描目录=${path.join(root, resourceName)}`,
    );
  }
  await assertReadable(verticalSource, "竖版封面");
  const verticalCover = await writeJpegWithinLimit(
    verticalSource,
    path.join(taskDir, "iqiyi-vertical-cover.jpg"),
    1080,
    1440,
    iqiyiCoverMaximumBytes,
  );

  const horizontalSource = task.playlet.horizontalCoverFile
    ? await resolveIqiyiAsset(task.playlet.horizontalCoverFile, options, "horizontal-cover")
    : await generateLandscapeCover(verticalCover, task, options);
  await assertReadable(horizontalSource, "横版封面");
  const horizontalCover = task.playlet.horizontalCoverFile
    ? await writeJpegWithinLimit(
      horizontalSource,
      path.join(taskDir, "iqiyi-horizontal-cover.jpg"),
      1920,
      1080,
      iqiyiCoverMaximumBytes,
    )
    : horizontalSource;

  const [productionProofFiles, licenseProofFiles] = await Promise.all([
    prepareProofReferences(
      task.playlet.copyright.productionProofFiles,
      taskDir,
      "production-proof",
      options,
    ),
    prepareProofReferences(
      task.playlet.copyright.licenseProofFiles,
      taskDir,
      "license-proof",
      options,
    ),
  ]);

  task.playlet.verticalCoverFile = verticalCover;
  task.playlet.horizontalCoverFile = horizontalCover;
  task.playlet.copyright.productionProofFiles = productionProofFiles;
  task.playlet.copyright.licenseProofFiles = licenseProofFiles;
  return { verticalCover, horizontalCover, productionProofFiles, licenseProofFiles };
}
