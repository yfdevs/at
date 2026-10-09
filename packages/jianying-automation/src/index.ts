import { execFile } from "node:child_process";
import { access, cp, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export {
  cropJianyingPreviewScreenshot,
  findDramaEpisodes,
  markPreparedEpisodeTrackWritten,
  prepareEpisodeDraft,
  readPreparedEpisodeDraft,
  type DramaEpisode,
  type PreparedEpisodeDraft,
} from "./episode-workflow.js";

export {
  resolveJianyingDraftWorkerPath,
  writeJianyingDraftVideoTrack,
  type JianyingDraftTrackResult,
} from "./draft-track.js";

const execFileAsync = promisify(execFile);

export type JianyingUiaElement = {
  name: string;
  automationId: string;
  controlType: string;
  className: string;
  value: string;
  helpText: string;
  legacyName: string;
  left: number;
  top: number;
  width: number;
  height: number;
  enabled: boolean;
  actionable: boolean;
};

export type JianyingUiaProbe = {
  available: boolean;
  operable: boolean;
  processCount: number;
  windowCount: number;
  controlCount: number;
  namedControlCount: number;
  actionableControlCount: number;
  message: string;
  windows: JianyingUiaElement[];
  samples: JianyingUiaElement[];
};

export type JianyingPresetSummary = {
  path: string;
  name: string;
  valid: boolean;
  videoCount: number;
  audioCount: number;
  timelineCount: number;
  hasDraftContent: boolean;
  hasDraftMetadata: boolean;
  draftContentReadable: boolean;
  draftMetadataReadable: boolean;
};

function processResourcesPath() {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
}

async function pathExists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveJianyingUiaHelperPath() {
  const resourcesPath = processResourcesPath();
  const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.JIANYING_UIA_HELPER_PATH,
    resourcesPath && path.join(resourcesPath, "jianying-automation", "JianyingUia.exe"),
    path.resolve(process.cwd(), "packages", "jianying-automation", "native", "bin", "JianyingUia.exe"),
    path.resolve(sourceDirectory, "..", "native", "bin", "JianyingUia.exe"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }

  throw new Error("剪映 UI Automation Helper 未构建");
}

async function runHelper<T>(args: string[], timeout = 30_000) {
  if (process.platform !== "win32") throw new Error("剪映 UI Automation 仅支持 Windows");
  const helperPath = await resolveJianyingUiaHelperPath();
  try {
    const { stdout } = await execFileAsync(helperPath, args, {
      encoding: "utf8",
      timeout,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    return JSON.parse(stdout.trim()) as T;
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout?.trim();
    if (stdout) {
      let message = "";
      try {
        const result = JSON.parse(stdout) as { message?: string };
        message = result.message ?? "";
      } catch {}
      if (message) throw new Error(message);
    }
    throw error;
  }
}

export function probeJianyingUia() {
  return runHelper<JianyingUiaProbe>(["probe"]);
}

export function launchJianyingWithUia(input: {
  executablePath: string;
  accessibilityConfigPath?: string | null;
  holdMilliseconds?: number;
}) {
  const args = [
    "launch",
    "--exe",
    input.executablePath,
    "--hold-ms",
    String(input.holdMilliseconds ?? 15_000),
  ];
  if (input.accessibilityConfigPath) {
    args.push("--config", input.accessibilityConfigPath);
  }
  return runHelper<JianyingUiaProbe>(args);
}

export function readJianyingUiaTree(maxElements = 500) {
  return runHelper<JianyingUiaProbe>(["tree", "--max-elements", String(maxElements)]);
}

type JianyingElementSelector = {
  name?: string;
  automationId?: string;
  className?: string;
  controlType?: string;
};

function appendSelector(args: string[], input: JianyingElementSelector) {
  if (input.name) args.push("--name", input.name);
  if (input.automationId) args.push("--automation-id", input.automationId);
  if (input.className) args.push("--class-name", input.className);
  if (input.controlType) args.push("--control-type", input.controlType);
}

export function invokeJianyingElement(input: JianyingElementSelector) {
  const args = ["invoke"];
  appendSelector(args, input);
  return runHelper<{ success: boolean; message: string; element?: JianyingUiaElement }>(args);
}

export function clickJianyingElement(input: JianyingElementSelector) {
  const args = ["click"];
  appendSelector(args, input);
  return runHelper<{ success: boolean; message: string; element?: JianyingUiaElement }>(args);
}

export function doubleClickJianyingElement(input: JianyingElementSelector) {
  const args = ["double-click"];
  appendSelector(args, input);
  return runHelper<{ success: boolean; message: string; element?: JianyingUiaElement }>(args);
}

export function setJianyingElementValue(input: {
  value: string;
} & JianyingElementSelector) {
  const args = ["set-value", "--value", input.value];
  appendSelector(args, input);
  return runHelper<{ success: boolean; message: string; element?: JianyingUiaElement }>(args);
}

export function typeJianyingElementText(input: {
  value: string;
} & JianyingElementSelector) {
  const args = ["type-text", "--value", input.value];
  appendSelector(args, input);
  return runHelper<{ success: boolean; message: string; element?: JianyingUiaElement }>(args);
}

export function captureJianyingWindow(outputPath: string) {
  return runHelper<{
    success: boolean;
    message: string;
    path: string;
    left: number;
    top: number;
    width: number;
    height: number;
  }>(["capture-window", "--output", path.resolve(outputPath)]);
}

export function clickJianyingPoint(x: number, y: number) {
  return runHelper<{ success: boolean; message: string; x: number; y: number }>([
    "click-point",
    "--x",
    String(Math.round(x)),
    "--y",
    String(Math.round(y)),
  ]);
}

export function seekJianyingTimeline(timeMicroseconds: number, durationMicroseconds: number) {
  return runHelper<{
    success: boolean;
    message: string;
    timeUs: number;
    durationUs: number;
    x: number;
    y: number;
  }>([
    "seek-timeline",
    "--time-us",
    String(Math.round(timeMicroseconds)),
    "--duration-us",
    String(Math.round(durationMicroseconds)),
  ]);
}

export function pressJianyingSpace() {
  return runHelper<{ success: boolean; message: string }>(["press-space"]);
}

export function pressJianyingEnter() {
  return runHelper<{ success: boolean; message: string }>(["press-enter"]);
}

export function returnJianyingHome() {
  return runHelper<{ success: boolean; message: string }>(["return-home"]);
}

export async function importJianyingMedia(files: string[]) {
  if (!files.length) throw new Error("没有可导入的分段视频");
  const batchSize = 4;
  for (let index = 0; index < files.length; index += batchSize) {
    const batch = files.slice(index, index + batchSize);
    await runHelper<{ success: boolean; message: string; fileCount: number }>([
      "import-media",
      ...batch.flatMap((file) => ["--file", path.resolve(file)]),
    ], 60_000);
    if (index + batchSize < files.length) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
  }
  return {
    success: true,
    message: "分段视频已导入剪映素材库",
    fileCount: files.length,
  };
}

async function countFiles(directory: string, expression: RegExp) {
  if (!(await pathExists(directory))) return 0;
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && expression.test(entry.name)).length;
}

export async function inspectJianyingPreset(presetPath: string): Promise<JianyingPresetSummary> {
  const normalizedPath = path.resolve(presetPath);
  const draftContentPath = path.join(normalizedPath, "draft_content.json");
  const draftMetadataPath = path.join(normalizedPath, "draft_meta_info.json");
  const hasDraftContent = await pathExists(draftContentPath);
  const hasDraftMetadata = await pathExists(draftMetadataPath);

  const canParseJson = async (filePath: string, exists: boolean) => {
    if (!exists) return false;
    try {
      JSON.parse(await readFile(filePath, "utf8"));
      return true;
    } catch {
      return false;
    }
  };
  const draftContentReadable = await canParseJson(draftContentPath, hasDraftContent);
  const draftMetadataReadable = await canParseJson(draftMetadataPath, hasDraftMetadata);

  const timelineDirectory = path.join(normalizedPath, "Timelines");
  const timelineEntries = await pathExists(timelineDirectory)
    ? await readdir(timelineDirectory, { withFileTypes: true })
    : [];

  return {
    path: normalizedPath,
    name: path.basename(normalizedPath),
    valid: hasDraftContent && hasDraftMetadata,
    videoCount: await countFiles(path.join(normalizedPath, "video_segments"), /\.mp4$/i),
    audioCount: await countFiles(normalizedPath, /\.(?:wav|mp3)$/i),
    timelineCount: timelineEntries.filter((entry) => entry.isDirectory()).length,
    hasDraftContent,
    hasDraftMetadata,
    draftContentReadable,
    draftMetadataReadable,
  };
}

export async function installJianyingPreset(input: {
  presetPath: string;
  draftRoot: string;
  draftName: string;
}) {
  const preset = await inspectJianyingPreset(input.presetPath);
  if (!preset.valid) throw new Error("不是有效的剪映草稿预设");

  const safeName = input.draftName.trim().replace(/[<>:"/\\|?*]/g, "-");
  if (!safeName) throw new Error("草稿名称不能为空");
  const draftRoot = path.resolve(input.draftRoot);
  const targetPath = path.join(draftRoot, safeName);
  if (path.dirname(targetPath) !== draftRoot) throw new Error("草稿目标路径无效");
  if (await pathExists(targetPath)) throw new Error(`草稿已存在：${safeName}`);

  await cp(preset.path, targetPath, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });

  return inspectJianyingPreset(targetPath);
}
