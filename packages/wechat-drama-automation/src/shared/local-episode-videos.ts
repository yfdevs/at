import path from "node:path";
import { access } from "node:fs/promises";
import fg from "fast-glob";
import { getWechatVideoRuntimeSettings } from "./runtime-settings.js";
import type { Config } from "./types.js";

export interface LocalEpisodeVideo {
  index: number;
  title: string;
  file: string;
}

const localEpisodeVideoPatterns = [
  "*.mp4",
  "{成片,成品,视频,正片}/*.mp4",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getOriginalTitle(config: Config): string {
  const originalTitle = config.originalTitle?.trim();
  if (!originalTitle) {
    throw new Error("originalTitle is required for local episode videos.");
  }
  return originalTitle;
}

function getPlayletVideoDir(config: Config): string {
  const localEpisodeVideoRoot = getWechatVideoRuntimeSettings().localEpisodeVideoRoot.trim();
  if (!localEpisodeVideoRoot) {
    throw new Error("localEpisodeVideoRoot is required for local episode videos.");
  }
  return path.join(localEpisodeVideoRoot, getOriginalTitle(config));
}

export async function findLocalEpisodeVideos(config: Config): Promise<LocalEpisodeVideo[]> {
  const playletDir = getPlayletVideoDir(config);
  if (!await pathExists(playletDir)) {
    throw new Error(`[local-video-invalid] 剧集视频目录不存在: ${playletDir}`);
  }

  const escapedOriginalTitle = escapeRegExp(getOriginalTitle(config));
  const fileNamePatterns = [
    new RegExp(`^${escapedOriginalTitle}(?:\\s*-\\s*|\\s*)第(\\d+)集\\.mp4$`, "i"),
    new RegExp(`^${escapedOriginalTitle}(?:\\s*-\\s*|\\s*)(\\d+)\\.mp4$`, "i"),
    /^(\d+)\.mp4$/i,
  ];
  const fileNames = await fg(localEpisodeVideoPatterns, {
    cwd: playletDir,
    onlyFiles: true,
    deep: 2,
  });

  const episodes = fileNames.flatMap((fileName): LocalEpisodeVideo[] => {
    const baseName = path.basename(fileName);
    const match = fileNamePatterns
      .map((pattern) => pattern.exec(baseName))
      .find((result): result is RegExpExecArray => result !== null);
    if (!match) return [];

    const index = Number(match[1]);
    return [{
      index,
      title: `第${index}集`,
      file: path.join(playletDir, fileName),
    }];
  }).sort((left, right) => left.index - right.index);

  return episodes;
}

async function pathExists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true, () => false);
}

export async function validateLocalEpisodeVideos(config: Config): Promise<void> {
  const episodes = await findLocalEpisodeVideos(config);
  const duplicateIndexes = episodes
    .filter((episode, index) => index > 0 && episode.index === episodes[index - 1].index)
    .map((episode) => episode.index);
  if (duplicateIndexes.length > 0) {
    throw new Error(`[local-video-invalid] 存在重复集数: ${[...new Set(duplicateIndexes)].join(", ")}`);
  }

  const expectedIndexes = Array.from({ length: config.playlet.episodeCount }, (_, index) => index + 1);
  const actualIndexes = episodes.map((episode) => episode.index);
  if (actualIndexes.length !== expectedIndexes.length || actualIndexes.some((value, index) => value !== expectedIndexes[index])) {
    throw new Error(
      `[local-video-invalid] 剧集文件应按文件名匹配第1集至第${config.playlet.episodeCount}集: ` +
      `originalTitle=${getOriginalTitle(config)} actual=[${actualIndexes.join(", ")}] dir=${getPlayletVideoDir(config)}`,
    );
  }
}
