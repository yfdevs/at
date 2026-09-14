import path from "node:path";
import { stat } from "node:fs/promises";
import {
  findOwnershipProjectProofFiles,
  listLocalOwnershipMaterials,
  type LocalOwnershipMaterialFile,
} from "@drama/drama-media-assets";
import { prepareUploadFiles } from "../automation/upload/upload-helpers.js";
import { resolveFromRoot } from "./config.js";
import { getWechatVideoRuntimeSettings } from "./runtime-settings.js";
import type { Config } from "./types.js";

const contractImageExtensions = new Set([".png", ".jpg", ".jpeg", ".bmp"]);
type OwnershipAiClient = NonNullable<Parameters<typeof findOwnershipProjectProofFiles>[0]["aiClient"]>;

function positiveProofCount(value: string) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0 ? count : 4;
}

export function getWechatOwnershipProofCounts() {
  const settings = getWechatVideoRuntimeSettings();
  return {
    jianying: positiveProofCount(settings.jianyingOwnershipProofCount),
    juchuang: positiveProofCount(settings.juchuangOwnershipProofCount),
  };
}

export function getWechatOwnershipRequirements() {
  const counts = getWechatOwnershipProofCounts();
  return { minimumImages: counts.jianying + counts.juchuang };
}

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
  for (const candidate of candidates) {
    try {
      const files = await prepareUploadFiles([candidate], resolveFromRoot, `${config.playlet.name}-contract`);
      if (files[0] && await isValidContractImage(files[0])) {
        resolved.push(files[0]);
        if (resolved.length === 2) break;
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

export async function loadWechatOwnershipMaterials(
  config: Config,
): Promise<LocalOwnershipMaterialFile[]> {
  const localEpisodeVideoRoot = getWechatVideoRuntimeSettings().localEpisodeVideoRoot.trim();
  const ownership = await listLocalOwnershipMaterials({
    root: localEpisodeVideoRoot,
    resourceName: config.originalTitle,
  });
  const required = getWechatOwnershipRequirements().minimumImages;
  if (ownership.length < required) {
    throw new Error(
      `[production-proof-invalid] 微信视频号权属材料不足：至少需要${required}张非竖图工程截图，` +
        `实际找到${ownership.length}张；扫描目录=${localEpisodeVideoRoot}`,
    );
  }
  return ownership;
}

export async function prepareWechatProductionProofMaterials(
  config: Config,
  aiClient: OwnershipAiClient,
) {
  const contractFiles = await resolveContractFiles(config);
  const localEpisodeVideoRoot = getWechatVideoRuntimeSettings().localEpisodeVideoRoot.trim();
  const ownership = await findOwnershipProjectProofFiles({
    root: localEpisodeVideoRoot,
    resourceName: config.originalTitle,
    aiClient,
    filesPerKind: getWechatOwnershipProofCounts(),
  });
  config.playlet.copyright.productionProofFiles = [
    ...contractFiles,
    ...ownership.files,
  ];

  return config.playlet.copyright.productionProofFiles;
}
