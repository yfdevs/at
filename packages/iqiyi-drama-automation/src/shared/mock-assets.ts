import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { IqiyiDramaRuntimeOptions } from "./types.js";

const mockAssetFiles = {
  productionContract: "模拟爱奇艺短剧制作合同.jpg",
  copyrightProof: "模拟爱奇艺版权证明.jpg",
} as const;

function defaultMockAssetRoot() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve("public", "iqiyi-drama", "mock-assets"),
    path.resolve("dist", "iqiyi-drama", "mock-assets"),
    path.resolve(moduleDir, "../../../../public/iqiyi-drama/mock-assets"),
    path.resolve(moduleDir, "../../../public/iqiyi-drama/mock-assets"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

export function iqiyiMockAssetPaths(
  options: Pick<IqiyiDramaRuntimeOptions, "mockAssetRoot"> = {},
) {
  const configuredRoot = options.mockAssetRoot?.trim();
  const assetRoot = configuredRoot ? path.resolve(configuredRoot) : defaultMockAssetRoot();
  return {
    productionContract: path.join(assetRoot, mockAssetFiles.productionContract),
    copyrightProof: path.join(assetRoot, mockAssetFiles.copyrightProof),
  };
}

export function ensureIqiyiMockAssets(options: Pick<IqiyiDramaRuntimeOptions, "mockAssetRoot"> = {}) {
  const assets = iqiyiMockAssetPaths(options);
  const missing = Object.values(assets).filter((file) => !existsSync(file));
  if (missing.length > 0) {
    throw new Error(`爱奇艺模拟任务缺少内置素材：${missing.join("、")}`);
  }
  return assets;
}
