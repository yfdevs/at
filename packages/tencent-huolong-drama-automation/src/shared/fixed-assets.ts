import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

function fixedAssetReference(sourceUrl: URL, bundledUrl: URL) {
  if (sourceUrl.protocol === "data:") return sourceUrl.href;
  const sourceAsset = fileURLToPath(sourceUrl);
  const bundledAsset = fileURLToPath(bundledUrl);
  return existsSync(sourceAsset) ? sourceAsset : bundledAsset;
}

export const tencentHuolongAiCreationDeclarationFile = fixedAssetReference(
  new URL("../assets/AI创作声明.pdf", import.meta.url),
  new URL(/* @vite-ignore */ "./assets/AI创作声明.pdf", import.meta.url),
);

export const tencentHuolongNonInfringementCommitmentFile = fixedAssetReference(
  new URL("../assets/权利声明.pdf", import.meta.url),
  new URL(/* @vite-ignore */ "./assets/权利声明.pdf", import.meta.url),
);
