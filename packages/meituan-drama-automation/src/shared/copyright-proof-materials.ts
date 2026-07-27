import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  composeOwnershipMaterialsIntoOne,
  listLocalOwnershipMaterials,
} from "@drama/drama-media-assets";
import { log } from "../automation/browser-session.js";
import { downloadRemoteAsset } from "../automation/upload/remote-assets.js";
import {
  getMeituanLocalEpisodeVideoRoot,
  getMeituanOriginalTitle,
} from "./local-episode-videos.js";
import type {
  ClaimedMeituanDramaTask,
  MeituanCreationRuntimeOptions,
} from "./types.js";

export type PreparedMeituanCopyrightProofMaterials = {
  files: string[];
  cleanup: () => Promise<void>;
};

function copyrightProofTaskDir(
  task: ClaimedMeituanDramaTask,
  options: MeituanCreationRuntimeOptions,
) {
  if (!options.assetDownloadDir) {
    throw new Error("MEITUAN_ASSET_DOWNLOAD_DIR_REQUIRED");
  }
  return path.join(
    path.dirname(options.assetDownloadDir),
    "copyright-proofs",
    String(task.accountTaskId),
  );
}

async function downloadProofFiles(options: {
  urls: string[];
  kind: "production" | "license";
  taskDir: string;
  runtimeOptions: MeituanCreationRuntimeOptions;
}) {
  const files: string[] = [];
  for (const [index, url] of options.urls.entries()) {
    files.push(await downloadRemoteAsset(
      url,
      {
        ...options.runtimeOptions,
        assetDownloadDir: path.join(options.taskDir, options.kind, String(index + 1)),
      },
      `${options.kind}-proof-${index + 1}`,
      `${options.kind} proof ${index + 1}`,
    ));
  }
  return files;
}

export async function prepareMeituanCopyrightProofMaterials(
  task: ClaimedMeituanDramaTask,
  options: MeituanCreationRuntimeOptions,
): Promise<PreparedMeituanCopyrightProofMaterials> {
  const taskDir = copyrightProofTaskDir(task, options);
  const cleanup = () => rm(taskDir, { recursive: true, force: true });

  await cleanup();
  await mkdir(taskDir, { recursive: true });

  try {
    const resourceName = getMeituanOriginalTitle(task);
    const ownershipFiles = await listLocalOwnershipMaterials({
      root: getMeituanLocalEpisodeVideoRoot(options),
      resourceName,
    });
    if (ownershipFiles.length === 0) {
      throw new Error(
        `[copyright-proof-invalid] 未找到工程或权属目录下的图片：${resourceName}`,
      );
    }

    const productionProofFiles = await downloadProofFiles({
      urls: task.playlet.productionProofFiles.slice(0, 1),
      kind: "production",
      taskDir,
      runtimeOptions: options,
    });
    const licenseProofFiles = await downloadProofFiles({
      urls: task.playlet.licenseProofFiles.slice(0, 1),
      kind: "license",
      taskDir,
      runtimeOptions: options,
    });
    const contractProofFiles = [
      ...productionProofFiles,
      ...licenseProofFiles,
    ];
    const ownershipComposite = await composeOwnershipMaterialsIntoOne({
      files: ownershipFiles,
      outputDir: path.dirname(ownershipFiles[0].file),
      resourceName,
    });
    const files = [
      ...contractProofFiles,
      ownershipComposite,
    ];

    log(
      options,
      `[meituan-drama] copyright proof materials ready: ` +
      `production=${productionProofFiles.length} license=${licenseProofFiles.length} ` +
      `contractUpload=${contractProofFiles.length} ` +
      `ownershipSource=${ownershipFiles.length} ownershipComposite=1 ` +
      `upload=${files.length}`,
    );
    return { files, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
