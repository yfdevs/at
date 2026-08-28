import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { IqiyiDramaRuntimeOptions } from "../shared/types.js";

function extension(contentType: string | null, source: string) {
  const sourceExtension = path.extname(new URL(source).pathname);
  if (sourceExtension) return sourceExtension;
  if (contentType?.includes("png")) return ".png";
  if (contentType?.includes("webp")) return ".webp";
  if (contentType?.includes("pdf")) return ".pdf";
  return ".jpg";
}

function safeName(value: string) {
  return value.replace(/[<>:"/\\|?*\p{Cc}]/gu, "_").slice(0, 120) || "asset";
}

export async function resolveIqiyiAsset(
  reference: string,
  options: IqiyiDramaRuntimeOptions,
  fallbackName: string,
) {
  const normalized = reference.trim();
  if (!/^https?:\/\//i.test(normalized)) return normalized;
  if (!options.assetDownloadDir) {
    throw new Error("爱奇艺素材下载目录未配置。");
  }

  const response = await fetch(normalized);
  if (!response.ok) {
    throw new Error(`IQIYI_DRAMA_ASSET_DOWNLOAD_FAILED: HTTP ${response.status}`);
  }
  const digest = createHash("sha1").update(normalized).digest("hex").slice(0, 10);
  const outputDir = path.join(options.assetDownloadDir, "remote-assets");
  const output = path.join(
    outputDir,
    `${safeName(fallbackName)}-${digest}${extension(response.headers.get("content-type"), normalized)}`,
  );
  await mkdir(outputDir, { recursive: true });
  await writeFile(output, Buffer.from(await response.arrayBuffer()));
  return output;
}
