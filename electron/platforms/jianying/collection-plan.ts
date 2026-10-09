import path from "node:path";

const NUMBERED_PRESET_PATTERN = /^新预设(\d+)$/;

export function sortNumberedPresetNames(names: string[]) {
  return names
    .map((name) => ({ name, number: Number(NUMBERED_PRESET_PATTERN.exec(name)?.[1]) }))
    .filter((preset) => Number.isInteger(preset.number) && preset.number > 0)
    .sort((left, right) => left.number - right.number)
    .map((preset) => preset.name);
}

export function presetNameForEpisode(presetNames: string[], episode: number) {
  if (!presetNames.length) throw new Error("没有找到可用的剪映预设");
  if (!Number.isInteger(episode) || episode < 1) throw new Error("剧集序号无效");
  return presetNames[(episode - 1) % presetNames.length]!;
}

export function ownershipScreenshotPath(
  dramaDirectory: string,
  dramaName: string,
  episode: number,
) {
  return path.join(
    path.resolve(dramaDirectory),
    "权属文件",
    `${dramaName}-第${episode}集-剪映窗口.png`,
  );
}
