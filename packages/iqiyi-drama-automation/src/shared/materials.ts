import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  listLocalOwnershipMaterials,
  listLocalPosterImages,
} from "@drama/drama-media-assets";
import sharp from "sharp";

import { resolveIqiyiAsset } from "../automation/remote-assets.js";
import { log } from "./logger.js";
import type { ClaimedIqiyiDramaTask, IqiyiDramaRuntimeOptions } from "./types.js";

const landscapePromptVersion = "iqiyi-landscape-v2";
const iqiyiCoverMaximumBytes = 4_900_000;
const iqiyiOwnershipMaximumBytes = 20 * 1024 * 1024;
const ownershipDirectoryPattern = /工程|权属|资质|版权/;
const ownershipExtensionPattern = /\.(?:jpe?g|png|bmp|webp|pdf)$/i;

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

function normalizedName(value: string) {
  return value.toLowerCase().replace(/[\s._\-—()（）[\]【】]/g, "");
}

async function candidateResourceDirectories(root: string, resourceName: string) {
  const exact = path.join(root, resourceName);
  if (await access(exact).then(() => true, () => false)) return [exact];
  const expected = normalizedName(resourceName);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      const actual = normalizedName(entry.name);
      return actual.includes(expected) || expected.includes(actual);
    })
    .map((entry) => path.join(root, entry.name));
}

async function listLocalIqiyiOwnershipFiles(root: string, resourceName: string) {
  const files: string[] = [];
  const directories = await candidateResourceDirectories(root, resourceName);
  const walk = async (directory: string, inOwnershipDirectory: boolean): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(file, inOwnershipDirectory || ownershipDirectoryPattern.test(entry.name));
      } else if (inOwnershipDirectory && entry.isFile() && ownershipExtensionPattern.test(entry.name)) {
        files.push(file);
      }
    }
  };
  for (const directory of directories) {
    await walk(directory, ownershipDirectoryPattern.test(path.basename(directory)));
  }
  return files.sort((left, right) => left.localeCompare(right, "zh-CN", { numeric: true }));
}

async function waitForLocalIqiyiOwnershipFiles(
  root: string,
  resourceName: string,
  options: IqiyiDramaRuntimeOptions,
) {
  const deadline = Date.now() + 5 * 60_000;
  while (true) {
    const files = await listLocalIqiyiOwnershipFiles(root, resourceName);
    if (files.length > 0 || Date.now() >= deadline) return files;
    log(options, "[iqiyi-drama] waiting for ownership directory download");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

async function prepareOwnershipFile(file: string, index: number, taskDir: string) {
  await assertReadable(file, "权属文件");
  const extension = path.extname(file).toLowerCase();
  if (extension === ".pdf" || extension === ".jpg" || extension === ".jpeg" || extension === ".png") {
    const info = await stat(file);
    if (info.size > iqiyiOwnershipMaximumBytes) {
      throw new Error(`[iqiyi-material-invalid] 权属文件超过 20MB：${file}`);
    }
    return file;
  }
  if (extension === ".bmp" || extension === ".webp") {
    return writeJpegWithinLimit(
      file,
      path.join(taskDir, `iqiyi-ownership-${index + 1}.jpg`),
      undefined,
      undefined,
      iqiyiOwnershipMaximumBytes - 100_000,
    );
  }
  throw new Error(`[iqiyi-material-invalid] 权属文件仅支持 JPG、PNG 或 PDF：${file}`);
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

  const remoteOwnershipFiles = await Promise.all(
    task.playlet.ownershipFiles.map((reference, index) =>
      resolveIqiyiAsset(reference, options, `ownership-${index + 1}`)
    ),
  );
  const localOwnershipImages = await listLocalOwnershipMaterials({
    root,
    resourceName,
    includePortraitImages: true,
  });
  const initialLocalOwnershipFiles = await listLocalIqiyiOwnershipFiles(root, resourceName);
  const localOwnershipFiles = task.playlet.baiduPanResourceLink
    && initialLocalOwnershipFiles.length === 0
    && localOwnershipImages.length === 0
    && remoteOwnershipFiles.length === 0
    ? await waitForLocalIqiyiOwnershipFiles(root, resourceName, options)
    : initialLocalOwnershipFiles;
  const rawOwnershipFiles = [...new Set([
    ...remoteOwnershipFiles,
    ...localOwnershipFiles,
    ...localOwnershipImages.map((item) => item.file),
  ])];
  if (rawOwnershipFiles.length === 0) {
    throw new Error(
      `[copyright-proof-invalid] 未找到爱奇艺权属文件；扫描目录=${path.join(root, resourceName)}`,
    );
  }
  if (rawOwnershipFiles.length > 20) {
    throw new Error(`[iqiyi-material-invalid] 爱奇艺权属文件最多上传 20 个，实际找到 ${rawOwnershipFiles.length} 个。`);
  }
  const ownershipFiles = await Promise.all(
    rawOwnershipFiles.map((file, index) => prepareOwnershipFile(file, index, taskDir)),
  );

  task.playlet.verticalCoverFile = verticalCover;
  task.playlet.horizontalCoverFile = horizontalCover;
  task.playlet.ownershipFiles = ownershipFiles;
  return { verticalCover, horizontalCover, ownershipFiles };
}
