import { mkdir } from "node:fs/promises";
import path from "node:path";
import { log } from "../automation/browser-session.js";
import { downloadRemoteAsset } from "../automation/upload/remote-assets.js";
import type {
  ClaimedMeituanDramaTask,
  MeituanCreationRuntimeOptions,
} from "./types.js";

export type PreparedMeituanCopyrightProofMaterials = {
  files: string[];
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
  await mkdir(taskDir, { recursive: true });

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
  const files = [
    ...productionProofFiles,
    ...licenseProofFiles,
  ];

  log(
    options,
    `[meituan-drama] copyright proof materials ready: ` +
      `production=${productionProofFiles.length} license=${licenseProofFiles.length} ` +
      `upload=${files.length}`,
  );
  return { files };
}
