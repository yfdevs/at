import { listLocalPosterImages } from "@drama/drama-media-assets";
import type { KuaishouDramaRuntimeOptions, KuaishouDramaTaskConfig } from "./types.js";
import { getKuaishouDramaLocalEpisodeVideoRoot } from "./local-episode-videos.js";

export async function prepareKuaishouDramaTaskMaterials(
  task: KuaishouDramaTaskConfig,
  resourceName: string,
  options: KuaishouDramaRuntimeOptions,
) {
  const localEpisodeVideoRoot = getKuaishouDramaLocalEpisodeVideoRoot(options);
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
  task.localCoverFile = selected.file;

  return selected;
}
