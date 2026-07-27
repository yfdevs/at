import { rm } from "node:fs/promises";
import path from "node:path";
import {
  composeOwnershipMaterialsIntoOne,
  listLocalOwnershipMaterials,
} from "@drama/drama-media-assets";
import type { ClaimedQqDramaTask, QqDramaRuntimeOptions } from "./types.js";
import {
  getQqDramaLocalEpisodeVideoRoot,
  getQqDramaOriginalTitle,
} from "./local-episode-videos.js";

export async function prepareQqDramaCopyrightProofMaterials(
  task: ClaimedQqDramaTask,
  options: QqDramaRuntimeOptions,
) {
  const resourceName = getQqDramaOriginalTitle(task);
  const ownershipFiles = await listLocalOwnershipMaterials({
    root: getQqDramaLocalEpisodeVideoRoot(options),
    resourceName,
  });
  if (ownershipFiles.length === 0) {
    throw new Error(
      `[copyright-proof-invalid] 未找到工程或权属目录下的图片：${resourceName}`,
    );
  }

  const ownershipComposite = await composeOwnershipMaterialsIntoOne({
    files: ownershipFiles,
    outputDir: path.dirname(ownershipFiles[0].file),
    resourceName,
  });

  return {
    files: [ownershipComposite],
    sourceCount: ownershipFiles.length,
    cleanup: () => rm(ownershipComposite, { force: true }),
  };
}
