import { createHash } from "node:crypto";
import { access, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { listLocalPosterImages } from "@drama/drama-media-assets";
import sharp from "sharp";

import { resolveIqiyiAsset } from "../automation/remote-assets.js";
import { log } from "./logger.js";
import type { ClaimedIqiyiDramaTask, IqiyiDramaRuntimeOptions } from "./types.js";

const landscapePromptVersion = "iqiyi-landscape-v2";
const iqiyiCoverMaximumBytes = 4_900_000;
const iqiyiProofMaximumBytes = 20 * 1024 * 1024;

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

  const source = await readFile(verticalCover);
  const cacheKey = createHash("sha256")
    .update(source)
    .update(model)
    .update(landscapePromptVersion)
    .digest("hex")
    .slice(0, 24);
  const outputDir = path.join(options.assetDownloadDir, "ai-landscape-covers", cacheKey);
  const output = path.join(outputDir, "iqiyi-landscape-1920x1080.jpg");
  await mkdir(outputDir, { recursive: true });
  if (await access(output).then(() => true, () => false)) {
    log(options, `[iqiyi-drama] reused AI landscape cover cache: ${output}`);
    return output;
  }

  const contentType = task.playlet.dramaType === "comic-drama" ? "漫剧" : "短剧";
  const prompt = [
    `根据参考竖版封面，为爱奇艺${contentType}生成一张 16:9 横版项目封面。`,
    "保持原封面的核心人物、人物关系、服饰、时代背景、色彩气质和作品辨识度。",
    "将竖版画面自然扩展到左右两侧，补全真实一致的场景，不要简单拉伸、镜像、拼接或加边框。",
    "主体位于安全区域，人物面部和关键道具完整清晰，适合 1920x1080 展示。",
    "不要新增平台标志、水印、角标、二维码或无关文字；参考图已有片名时尽量保持其内容和位置稳定。",
    `作品名：${task.playlet.title}。`,
  ].join("\n");
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
