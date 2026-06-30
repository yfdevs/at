import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { KuaishouDramaRuntimeOptions } from "../../shared/types.js";
import { log } from "../browser-session.js";

function remoteFileExtension(url: URL, contentType: string | null) {
  const extension = extname(url.pathname);
  if (extension && extension.length <= 10) return extension;

  const extensionsByContentType: Record<string, string> = {
    "application/pdf": ".pdf",
    "image/bmp": ".bmp",
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
  };
  return extensionsByContentType[contentType?.split(";")[0].trim().toLowerCase() ?? ""] ?? ".bin";
}

function remoteFileName(url: URL, contentType: string | null, fallbackBaseName: string) {
  const urlFileName = basename(url.pathname);
  if (urlFileName && urlFileName !== "." && urlFileName !== "/") return urlFileName;

  return `${fallbackBaseName}${remoteFileExtension(url, contentType)}`;
}

function assetDownloadDir(options: KuaishouDramaRuntimeOptions) {
  if (options.assetDownloadDir) {
    return options.assetDownloadDir;
  }

  throw new Error("KUAISHOU_DRAMA_ASSET_DOWNLOAD_DIR_REQUIRED");
}

export async function downloadRemoteAsset(
  assetUrl: string,
  options: KuaishouDramaRuntimeOptions,
  fallbackBaseName: string,
  logLabel: string,
) {
  const downloadDir = assetDownloadDir(options);
  const url = new URL(assetUrl);
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 120_000);

  try {
    const response = await fetch(assetUrl, {
      redirect: "follow",
      signal: abortController.signal,
    });
    if (!response.ok) {
      throw new Error(`KUAISHOU_DRAMA_ASSET_DOWNLOAD_FAILED: HTTP ${response.status}: ${assetUrl}`);
    }

    const contentType = response.headers.get("content-type");
    const target = join(downloadDir, remoteFileName(url, contentType, fallbackBaseName));
    await mkdir(downloadDir, { recursive: true });
    await writeFile(target, Buffer.from(await response.arrayBuffer()));
    log(options, `[kuaishou-drama] ${logLabel} downloaded: ${target}`);
    return target;
  } catch (error) {
    if (abortController.signal.aborted) {
      throw Object.assign(new Error(`KUAISHOU_DRAMA_ASSET_DOWNLOAD_TIMEOUT: ${assetUrl}`), {
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
