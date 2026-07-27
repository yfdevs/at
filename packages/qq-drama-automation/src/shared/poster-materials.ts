import { listLocalPosterImages } from "@drama/drama-media-assets";
import type { ClaimedQqDramaTask, QqDramaRuntimeOptions } from "./types.js";
import {
  getQqDramaLocalEpisodeVideoRoot,
  getQqDramaOriginalTitle,
} from "./local-episode-videos.js";

export async function prepareQqDramaPosterMaterial(
  task: ClaimedQqDramaTask,
  options: QqDramaRuntimeOptions,
) {
  const localEpisodeVideoRoot = getQqDramaLocalEpisodeVideoRoot(options);
  const resourceName = getQqDramaOriginalTitle(task);
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
  task.playlet.localCoverFile = selected.file;
  return selected;
}
