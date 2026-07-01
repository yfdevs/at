import { access } from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import type { MeituanCreationTaskConfig } from "./types.js";

export interface MeituanCreationLocalEpisodeVideo {
  index: number;
  file: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveFromCwd(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

async function pathExists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true, () => false);
}

async function resolveEpisodeSearchDir(
  localEpisodeVideoRoot: string | undefined,
  taskConfig: MeituanCreationTaskConfig,
): Promise<string> {
  const root = localEpisodeVideoRoot?.trim();
  if (!root) {
    throw new Error("MEITUAN_LOCAL_VIDEO_ROOT_REQUIRED");
  }

  const resolvedRoot = resolveFromCwd(root);
  const titledDir = path.join(resolvedRoot, taskConfig.collectionTitle);
  if (await pathExists(titledDir)) {
    return titledDir;
  }

  if (await pathExists(resolvedRoot)) {
    return resolvedRoot;
  }

  throw new Error(`MEITUAN_LOCAL_VIDEO_ROOT_NOT_FOUND: root=${resolvedRoot}`);
}

export async function findLocalEpisodeVideos(
  taskConfig: MeituanCreationTaskConfig,
  localEpisodeVideoRoot: string | undefined,
): Promise<MeituanCreationLocalEpisodeVideo[]> {
  const searchDir = await resolveEpisodeSearchDir(localEpisodeVideoRoot, taskConfig);
  const fileNamePattern = new RegExp(
    `^${escapeRegExp(taskConfig.collectionTitle)}\\s*[-_—–]?\\s*第(\\d+)集\\.mp4$`,
    "i",
  );
  const fileNames = await glob("*.mp4", {
    cwd: searchDir,
    nodir: true,
    maxDepth: 1,
  });

  return fileNames
    .flatMap((fileName): MeituanCreationLocalEpisodeVideo[] => {
      const match = fileNamePattern.exec(path.basename(fileName));
      if (!match) return [];

      return [{
        index: Number(match[1]),
        file: path.join(searchDir, fileName),
      }];
    })
    .sort((left, right) => left.index - right.index);
}

export async function findRequiredLocalEpisodeVideos(
  taskConfig: MeituanCreationTaskConfig,
  localEpisodeVideoRoot: string | undefined,
): Promise<MeituanCreationLocalEpisodeVideo[]> {
  const episodes = await findLocalEpisodeVideos(taskConfig, localEpisodeVideoRoot);
  return episodes.filter((episode) => (
    episode.index >= 1 && episode.index <= taskConfig.totalEpisodes
  ));
}

export async function validateLocalEpisodeVideos(
  taskConfig: MeituanCreationTaskConfig,
  localEpisodeVideoRoot: string | undefined,
): Promise<void> {
  const episodes = await findRequiredLocalEpisodeVideos(taskConfig, localEpisodeVideoRoot);
  const duplicateIndexes = episodes
    .filter((episode, index) => index > 0 && episode.index === episodes[index - 1].index)
    .map((episode) => episode.index);

  if (duplicateIndexes.length > 0) {
    throw new Error(
      `MEITUAN_LOCAL_VIDEO_DUPLICATE_EPISODES: indexes=${[...new Set(duplicateIndexes)].join(",")}`,
    );
  }

  const expectedIndexes = Array.from({ length: taskConfig.totalEpisodes }, (_, index) => index + 1);
  const actualIndexes = episodes.map((episode) => episode.index);
  if (
    expectedIndexes.some((value, index) => actualIndexes[index] !== value)
  ) {
    throw new Error(
      `MEITUAN_LOCAL_VIDEO_EPISODE_MISMATCH: collectionTitle=${taskConfig.collectionTitle} ` +
      `expected=1-${taskConfig.totalEpisodes} actual=[${actualIndexes.join(",")}]`,
    );
  }
}
