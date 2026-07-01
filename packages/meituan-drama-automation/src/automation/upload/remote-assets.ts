import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { MeituanCreationRuntimeOptions } from "../../shared/types.js";
import { log } from "../browser-session.js";

function remoteFileExtension(url: URL, contentType: string | null) {
  const extension = extname(url.pathname);
  if (extension && extension.length <= 10) return extension;

  const extensionsByContentType: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
  };
  return extensionsByContentType[contentType?.split(";")[0].trim().toLowerCase() ?? ""] ?? ".bin";
}

function remoteFileName(url: URL, contentType: string | null, fallbackBaseName: string) {
  const urlFileName = basename(url.pathname);
  if (urlFileName && urlFileName !== "." && urlFileName !== "/") return urlFileName;

  return `${fallbackBaseName}${remoteFileExtension(url, contentType)}`;
}

export async function downloadRemoteAsset(
  assetUrl: string,
  options: MeituanCreationRuntimeOptions,
  fallbackBaseName: string,
  logLabel: string,
) {
  if (!options.assetDownloadDir) {
    throw new Error("MEITUAN_ASSET_DOWNLOAD_DIR_REQUIRED");
  }

  const url = new URL(assetUrl);
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 120_000);

  try {
    const response = await fetch(assetUrl, {
      redirect: "follow",
      signal: abortController.signal,
    });
    if (!response.ok) {
      throw new Error(`MEITUAN_ASSET_DOWNLOAD_FAILED: HTTP ${response.status}: ${assetUrl}`);
    }

    const contentType = response.headers.get("content-type");
    const target = join(
      options.assetDownloadDir,
      remoteFileName(url, contentType, fallbackBaseName),
    );
    await mkdir(options.assetDownloadDir, { recursive: true });
    await writeFile(target, Buffer.from(await response.arrayBuffer()));
    log(options, `[meituan-drama] ${logLabel} downloaded: ${target}`);
    return target;
  } catch (error) {
    if (abortController.signal.aborted) {
      throw Object.assign(new Error(`MEITUAN_ASSET_DOWNLOAD_TIMEOUT: ${assetUrl}`), {
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
