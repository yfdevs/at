import { findLocalEpisodeVideos, validateLocalEpisodeVideos } from "@drama/drama-media-assets";
import type { TaobaoBatchUploadTask, TaobaoDramaRuntimeOptions } from "./types.js";

export function taobaoMaterialRoot(options: TaobaoDramaRuntimeOptions) {
  const root = options.localMaterialRoot?.trim();
  if (!root) throw new Error("TAOBAO_DRAMA_LOCAL_MATERIAL_ROOT_REQUIRED");
  return root;
}

export async function validateTaobaoEpisodeVideos(
  task: TaobaoBatchUploadTask,
  options: TaobaoDramaRuntimeOptions,
) {
  await validateLocalEpisodeVideos({
    localEpisodeVideoRoot: taobaoMaterialRoot(options),
    resourceName: task.originalTitle,
    episodeCount: task.episodeCount,
  });
}

export function findTaobaoEpisodeVideos(
  task: TaobaoBatchUploadTask,
  options: TaobaoDramaRuntimeOptions,
) {
  return findLocalEpisodeVideos({
    localEpisodeVideoRoot: taobaoMaterialRoot(options),
    resourceName: task.originalTitle,
  });
}
