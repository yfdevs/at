import path from "node:path";
import { mkdir, stat, writeFile } from "node:fs/promises";
import sharp from "sharp";

export type ImageUploadPolicy = {
  maxFileBytes: number;
  targetFileBytes: number;
  minimumWidth: number;
  minimumHeight: number;
  maximumWidth?: number;
  maximumHeight?: number;
  minimumJpegQuality?: number;
  targetAspectRatio?: {
    width: number;
    height: number;
    tolerance?: number;
  };
};

export type PreparedImageUploadFile = {
  sourceFile: string;
  file: string;
  originalSize: number;
  outputSize: number;
  width: number;
  height: number;
  compressed: boolean;
  quality?: number;
};

export type PreparedStretchedImageVariant = {
  sourceFile: string;
  file: string;
  size: number;
  width: number;
  height: number;
  quality: number;
};

export async function prepareStretchedImageVariant(options: {
  inputFile: string;
  outputFile: string;
  width: number;
  height: number;
  jpegQuality?: number;
  maxFileBytes?: number;
  onLog?: (message: string) => void;
}): Promise<PreparedStretchedImageVariant> {
  const width = Math.floor(options.width);
  const height = Math.floor(options.height);
  if (width <= 0 || height <= 0) {
    throw new Error(`[image-resize-failed] 目标图片宽高必须大于 0：${width}x${height}`);
  }
  const sourceStat = await stat(options.inputFile).catch(() => undefined);
  if (!sourceStat?.isFile() || sourceStat.size <= 0) {
    throw new Error(`[poster-material-invalid] 图片文件不存在或为空：${options.inputFile}`);
  }

  const initialQuality = Math.max(80, Math.min(100, options.jpegQuality ?? 92));
  const qualities = [initialQuality, 88, 84, 80]
    .filter((quality, index, values) => quality <= initialQuality && values.indexOf(quality) === index)
    .sort((left, right) => right - left);
  await mkdir(path.dirname(options.outputFile), { recursive: true });
  let outputBuffer: Buffer | undefined;
  let selectedQuality = initialQuality;
  for (const quality of qualities) {
    const candidate = await sharp(options.inputFile, { failOn: "error" })
      .rotate()
      .resize({ width, height, fit: "fill" })
      .flatten({ background: "#ffffff" })
      .toColourspace("srgb")
      .jpeg({
        quality,
        progressive: true,
        mozjpeg: true,
        chromaSubsampling: "4:4:4",
      })
      .toBuffer();
    if (options.maxFileBytes && candidate.length > options.maxFileBytes) continue;
    outputBuffer = candidate;
    selectedQuality = quality;
    break;
  }
  if (!outputBuffer) {
    throw new Error(
      `[image-resize-failed] 在 JPEG 质量不低于 80 的前提下无法压缩到 ` +
        `${options.maxFileBytes} 字节以内：${options.inputFile}`,
    );
  }
  await writeFile(options.outputFile, outputBuffer);

  const outputStat = await stat(options.outputFile);
  const metadata = await sharp(options.outputFile, { failOn: "error" }).metadata();
  if (metadata.width !== width || metadata.height !== height || outputStat.size <= 0) {
    throw new Error(
      `[image-resize-failed] 生成图片校验失败：expected=${width}x${height} ` +
        `actual=${metadata.width ?? 0}x${metadata.height ?? 0} file=${options.outputFile}`,
    );
  }
  options.onLog?.(
    `[image-resize] 拉伸生成图片：${options.inputFile} -> ${options.outputFile} ` +
      `${width}x${height} quality=${selectedQuality} size=${outputStat.size}`,
  );
  return {
    sourceFile: options.inputFile,
    file: options.outputFile,
    size: outputStat.size,
    width,
    height,
    quality: selectedQuality,
  };
}

function orientedDimensions(metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>) {
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  return [5, 6, 7, 8].includes(metadata.orientation ?? 1)
    ? { width: height, height: width }
    : { width, height };
}

function assertImagePolicy(policy: ImageUploadPolicy) {
  if (
    policy.maxFileBytes <= 0 ||
    policy.targetFileBytes <= 0 ||
    policy.targetFileBytes >= policy.maxFileBytes
  ) {
    throw new Error("[image-compress-failed] 图片目标体积必须大于 0 且小于上传上限。");
  }
  if (policy.minimumWidth <= 0 || policy.minimumHeight <= 0) {
    throw new Error("[image-compress-failed] 图片最小宽高必须大于 0。");
  }
}

function assertImageDimensions(
  inputFile: string,
  width: number,
  height: number,
  policy: ImageUploadPolicy,
) {
  if (width < policy.minimumWidth || height < policy.minimumHeight) {
    throw new Error(
      `[poster-material-invalid] 图片分辨率不足：${width}x${height}，` +
        `最低要求=${policy.minimumWidth}x${policy.minimumHeight}；文件=${inputFile}`,
    );
  }
  if (policy.targetAspectRatio) {
    const targetRatio = policy.targetAspectRatio.width / policy.targetAspectRatio.height;
    const actualRatio = width / height;
    const tolerance = policy.targetAspectRatio.tolerance ?? 0.02;
    if (Math.abs(actualRatio - targetRatio) > tolerance) {
      throw new Error(
        `[poster-material-invalid] 图片比例不符合要求：${width}x${height}，` +
          `目标比例=${policy.targetAspectRatio.width}:${policy.targetAspectRatio.height}；` +
          `文件=${inputFile}`,
      );
    }
  }
}

export async function prepareImageForUpload(options: {
  inputFile: string;
  outputDir: string;
  outputFileName: string;
  policy: ImageUploadPolicy;
  onLog?: (message: string) => void;
}): Promise<PreparedImageUploadFile> {
  assertImagePolicy(options.policy);
  const sourceStat = await stat(options.inputFile).catch(() => undefined);
  if (!sourceStat?.isFile() || sourceStat.size <= 0) {
    throw new Error(`[poster-material-invalid] 图片文件不存在或为空：${options.inputFile}`);
  }

  const metadata = await sharp(options.inputFile, { failOn: "error" }).metadata();
  const sourceDimensions = orientedDimensions(metadata);
  if (!sourceDimensions.width || !sourceDimensions.height) {
    throw new Error(`[poster-material-invalid] 无法读取图片尺寸：${options.inputFile}`);
  }
  assertImageDimensions(
    options.inputFile,
    sourceDimensions.width,
    sourceDimensions.height,
    options.policy,
  );

  const passthroughExtensions = new Set([".jpg", ".jpeg", ".png"]);
  const sourceExtension = path.extname(options.inputFile).toLowerCase();
  if (
    sourceStat.size <= options.policy.maxFileBytes &&
    passthroughExtensions.has(sourceExtension)
  ) {
    options.onLog?.(
      `[image-upload] 原图符合上传限制，无损直传：size=${sourceStat.size} ` +
        `dimensions=${sourceDimensions.width}x${sourceDimensions.height} file=${options.inputFile}`,
    );
    return {
      sourceFile: options.inputFile,
      file: options.inputFile,
      originalSize: sourceStat.size,
      outputSize: sourceStat.size,
      width: sourceDimensions.width,
      height: sourceDimensions.height,
      compressed: false,
    };
  }

  const maximumWidth = Math.max(
    options.policy.minimumWidth,
    options.policy.maximumWidth ?? sourceDimensions.width,
  );
  const maximumHeight = Math.max(
    options.policy.minimumHeight,
    options.policy.maximumHeight ?? sourceDimensions.height,
  );
  const initialScale = Math.min(
    1,
    maximumWidth / sourceDimensions.width,
    maximumHeight / sourceDimensions.height,
  );
  let candidateWidth = Math.max(
    options.policy.minimumWidth,
    Math.floor(sourceDimensions.width * initialScale),
  );
  let candidateHeight = Math.max(
    options.policy.minimumHeight,
    Math.floor(sourceDimensions.height * initialScale),
  );
  const minimumQuality = Math.max(1, Math.min(100, options.policy.minimumJpegQuality ?? 80));
  const qualities = [92, 88, 84, 80].filter((quality) => quality >= minimumQuality);
  if (!qualities.includes(minimumQuality)) qualities.push(minimumQuality);

  await mkdir(options.outputDir, { recursive: true });
  while (
    candidateWidth >= options.policy.minimumWidth &&
    candidateHeight >= options.policy.minimumHeight
  ) {
    for (const quality of qualities) {
      const result = await sharp(options.inputFile, { failOn: "error" })
        .rotate()
        .resize({
          width: candidateWidth,
          height: candidateHeight,
          fit: "inside",
          withoutEnlargement: true,
        })
        .flatten({ background: "#ffffff" })
        .toColourspace("srgb")
        .jpeg({
          quality,
          progressive: true,
          mozjpeg: true,
          chromaSubsampling: "4:4:4",
        })
        .toBuffer({ resolveWithObject: true });
      if (result.data.length > options.policy.targetFileBytes) continue;

      assertImageDimensions(
        options.inputFile,
        result.info.width,
        result.info.height,
        options.policy,
      );
      const outputFile = path.join(options.outputDir, options.outputFileName);
      await writeFile(outputFile, result.data);
      options.onLog?.(
        `[image-upload] 图片压缩完成：${sourceStat.size} -> ${result.data.length} bytes ` +
          `${sourceDimensions.width}x${sourceDimensions.height} -> ` +
          `${result.info.width}x${result.info.height} quality=${quality} file=${outputFile}`,
      );
      return {
        sourceFile: options.inputFile,
        file: outputFile,
        originalSize: sourceStat.size,
        outputSize: result.data.length,
        width: result.info.width,
        height: result.info.height,
        compressed: true,
        quality,
      };
    }

    if (
      candidateWidth === options.policy.minimumWidth ||
      candidateHeight === options.policy.minimumHeight
    ) {
      break;
    }
    candidateWidth = Math.max(
      options.policy.minimumWidth,
      Math.floor(candidateWidth * 0.85),
    );
    candidateHeight = Math.max(
      options.policy.minimumHeight,
      Math.floor(candidateHeight * 0.85),
    );
  }

  throw new Error(
    `[image-compress-failed] 在不低于 ${minimumQuality} JPEG 质量和 ` +
      `${options.policy.minimumWidth}x${options.policy.minimumHeight} 分辨率的前提下，` +
      `无法将图片压缩到 ${options.policy.targetFileBytes} 字节以内：${options.inputFile}`,
  );
}
