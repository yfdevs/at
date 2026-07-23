import path from "node:path";
import { rm, stat } from "node:fs/promises";
import {
  composeOwnershipMaterialsIntoTwo,
  listLocalOwnershipMaterials,
  safeEpisodeFileBaseName,
} from "@drama/drama-media-assets";
import { prepareUploadFiles } from "../automation/upload/upload-helpers.js";
import { resolveFromRoot, resolveRunDataPath } from "./config.js";
import { getWechatVideoRuntimeSettings } from "./runtime-settings.js";
import { booleanSetting } from "./settings-value.js";
import type { Config } from "./types.js";

export const wechatOwnershipRequirements = {
  minimumImages: 1,
} as const;

const contractImageExtensions = new Set([".png", ".jpg", ".jpeg", ".bmp"]);

async function isValidContractImage(file: string) {
  if (!contractImageExtensions.has(path.extname(file).toLowerCase())) return false;
  const fileStat = await stat(file).catch(() => undefined);
  return Boolean(fileStat?.isFile() && fileStat.size > 0);
}

async function resolveContractFiles(config: Config) {
  const candidates = config.playlet.copyright.productionProofFiles?.filter(Boolean) ?? [];
  if (candidates.length < 1) {
    throw new Error("[production-proof-invalid] 合同材料至少需要1张。");
  }

  const errors: string[] = [];
  const resolved: string[] = [];
  for (const candidate of candidates.slice(0, 2)) {
    try {
      const files = await prepareUploadFiles([candidate], resolveFromRoot, `${config.playlet.name}-contract`);
      if (files[0] && await isValidContractImage(files[0])) {
        resolved.push(files[0]);
        continue;
      }
      errors.push(`${candidate}: 文件不存在或不支持`);
    } catch (error) {
      errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (resolved.length > 0) return resolved;
  throw new Error(
    `[production-proof-invalid] 没有可用合同图片。${errors.length > 0 ? ` ${errors.join("；")}` : ""}`,
  );
}

export async function prepareWechatProductionProofMaterials(config: Config) {
  const localEpisodeVideoRoot = getWechatVideoRuntimeSettings().localEpisodeVideoRoot.trim();
  const ownership = await listLocalOwnershipMaterials({
    root: localEpisodeVideoRoot,
    resourceName: config.originalTitle,
  });
  const missing: string[] = [];
  if (ownership.length < 1) missing.push("未找到工程或权属目录下的图片");
  if (missing.length > 0) {
    throw new Error(
      `[production-proof-invalid] 微信视频号权属材料不足：${missing.join("；")}；` +
        `扫描目录=${localEpisodeVideoRoot}`,
    );
  }

  const contractFiles = await resolveContractFiles(config);
  const ownershipFiles = ownership;
  const uploadOwnershipFiles = booleanSetting(
    getWechatVideoRuntimeSettings().mergeOwnershipMaterials,
  )
    ? await composeOwnershipMaterialsIntoTwo({
      files: ownershipFiles,
      outputDir: resolveRunDataPath("production-proof-composites"),
      resourceName: config.playlet.name,
    })
    : [];
  config.playlet.copyright.productionProofFiles = [
    ...contractFiles.slice(0, 2),
    ...(uploadOwnershipFiles.length ? uploadOwnershipFiles : ownershipFiles.slice(0, 2).map((file) => file.file)),
  ];

  return config.playlet.copyright.productionProofFiles;
}

export async function cleanupWechatProductionProofMaterials(config: Config) {
  if (!booleanSetting(getWechatVideoRuntimeSettings().mergeOwnershipMaterials)) return;
  const baseName = `${safeEpisodeFileBaseName(config.playlet.name)}-权属工程文件合成`;
  const dir = resolveRunDataPath("production-proof-composites");
  await Promise.all([
    rm(path.join(dir, `${baseName}1.jpg`), { force: true }),
    rm(path.join(dir, `${baseName}2.jpg`), { force: true }),
  ]);
}
