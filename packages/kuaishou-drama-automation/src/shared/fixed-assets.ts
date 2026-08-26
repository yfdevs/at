import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

function fixedAssetReference(sourceUrl: URL, bundledUrl: URL) {
  if (sourceUrl.protocol === "data:") return sourceUrl.href;
  const sourceAsset = fileURLToPath(sourceUrl);
  const bundledAsset = fileURLToPath(bundledUrl);
  return existsSync(sourceAsset) ? sourceAsset : bundledAsset;
}

export const kuaishouAuthorizationPromotionFile = fixedAssetReference(
  new URL("../assets/授权推广.jpg", import.meta.url),
  new URL("./assets/授权推广.jpg", import.meta.url),
);

export const kuaishouCopyrightDeclarationFile = fixedAssetReference(
  new URL("../assets/短剧制作协议.jpg", import.meta.url),
  new URL("./assets/短剧制作协议.jpg", import.meta.url),
);
