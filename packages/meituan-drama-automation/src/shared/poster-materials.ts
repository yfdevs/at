import { listLocalPosterImages } from "@drama/drama-media-assets";
import type {
  ClaimedMeituanDramaTask,
  MeituanCreationRuntimeOptions,
} from "./types.js";
import {
  getMeituanLocalEpisodeVideoRoot,
  getMeituanOriginalTitle,
} from "./local-episode-videos.js";

export async function prepareMeituanPosterMaterial(
  task: ClaimedMeituanDramaTask,
  options: MeituanCreationRuntimeOptions,
) {
  const localEpisodeVideoRoot = getMeituanLocalEpisodeVideoRoot(options);
  const resourceName = getMeituanOriginalTitle(task);
  const files = await listLocalPosterImages({
    root: localEpisodeVideoRoot,
    resourceName,
  });
  if (files.length < 1) {
    throw new Error(
      `[poster-material-invalid] 未找到文件名或目录名包含“封面”或“海报”的图片；` +
      `扫描目录=${localEpisodeVideoRoot}`,
    );
  }

  const selected = files[0];
  task.playlet.collectionCoverFile = selected.file;
  return selected;
}
