import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getWechatMiniProgramRuntimeSettings } from "./runtime-settings.js";

const mockAssetFiles = {
  licenseAuthorization: "模拟版权授权书.jpg",
  productionContract: "模拟短剧制作合同.jpg",
  productionCostProof: "模拟制作成本证明.jpg",
  aiProductionProof: "模拟AI制作证明.png",
} as const;

function defaultMockAssetRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve("public", "wechat-miniprogram-drama", "mock-assets"),
    path.resolve(moduleDir, "../../../../public/wechat-miniprogram-drama/mock-assets"),
    path.resolve(moduleDir, "../../../public/wechat-miniprogram-drama/mock-assets"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

export function wechatMiniProgramMockAssetPaths() {
  const configuredRoot = getWechatMiniProgramRuntimeSettings().mockAssetRoot.trim();
  const assetDir = configuredRoot
    ? path.resolve(configuredRoot)
    : defaultMockAssetRoot();
  return {
    licenseAuthorization: path.join(assetDir, mockAssetFiles.licenseAuthorization),
    productionContract: path.join(assetDir, mockAssetFiles.productionContract),
    productionCostProof: path.join(assetDir, mockAssetFiles.productionCostProof),
    aiProductionProof: path.join(assetDir, mockAssetFiles.aiProductionProof),
  };
}

export async function ensureWechatMiniProgramMockAssets(): Promise<ReturnType<typeof wechatMiniProgramMockAssetPaths>> {
  const paths = wechatMiniProgramMockAssetPaths();
  const missingFiles = Object.values(paths).filter((file) => !existsSync(file));
  if (missingFiles.length > 0) {
    throw new Error(`微信小程序模拟任务缺少内置素材：${missingFiles.join("、")}`);
  }
  return paths;
}
