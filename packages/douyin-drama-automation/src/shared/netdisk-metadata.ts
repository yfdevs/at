import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { log } from "./logger.js";
import type {
  ClaimedDouyinDramaTask,
  DouyinDramaRole,
  DouyinDramaRuntimeOptions,
} from "./types.js";

const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".bmp", ".webp"]);
const textExtensions = new Set([".txt", ".md"]);
const MAX_TEXT_FILES = 10;
const MAX_TOTAL_TEXT_CHARACTERS = 30_000;
const MAX_IMAGE_CANDIDATES = 100;

function parseAiJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^\uFEFF/, "");
  const normalized = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim() ?? trimmed;
  const candidates = [normalized];
  const start = normalized.indexOf("{");
  const end = normalized.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(normalized.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the provider-trimmed object candidate below.
    }
  }
  throw new Error("DOUYIN_DRAMA_AI_JSON_RESPONSE_INVALID");
}

const aiRoleSchema = z.object({
  name: z.string().trim().min(1).max(30),
  roleType: z.enum(["主角", "配角", "参演"]),
  intro: z.string().trim().min(1).max(100),
  photoImageId: z.string().trim().nullish(),
});

const aiMetadataSchema = z.object({
  summary: z.string().trim().min(1).max(200),
  roles: z.array(aiRoleSchema).max(10),
});

type MetadataImage = {
  id: string;
  file: string;
  fileName: string;
  relativePath: string;
};

type MetadataInputs = {
  images: MetadataImage[];
  texts: Array<{ fileName: string; relativePath: string; content: string }>;
};

function replacementCharacterCount(value: string) {
  return [...value].filter((character) => character === "\uFFFD").length;
}

function decodeText(buffer: Buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString("utf16le");
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.allocUnsafe(buffer.length - 2);
    for (let index = 2; index + 1 < buffer.length; index += 2) {
      swapped[index - 2] = buffer[index + 1];
      swapped[index - 1] = buffer[index];
    }
    return swapped.toString("utf16le");
  }
  const utf8 = buffer.toString("utf8").replace(/^\uFEFF/, "");
  if (replacementCharacterCount(utf8) <= Math.max(1, utf8.length / 200)) return utf8;
  try {
    return new TextDecoder("gb18030").decode(buffer).replace(/^\uFEFF/, "");
  } catch {
    return utf8;
  }
}

async function walkFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

export async function collectDouyinNetdiskMetadataInputs(
  resourceDir: string,
): Promise<MetadataInputs> {
  const files = await walkFiles(resourceDir);
  const preferredOriginalImageRoot = path.join(resourceDir, "海报封面", "原始图片");
  const hasOriginalImages = (await stat(preferredOriginalImageRoot).catch(() => undefined))?.isDirectory();
  const imageFiles = files
    .filter((file) => imageExtensions.has(path.extname(file).toLowerCase()))
    .filter((file) => {
      const normalized = file.replace(/\\/g, "/");
      if (/\/权属文件\//.test(normalized)) return false;
      if (hasOriginalImages) {
        return path.relative(preferredOriginalImageRoot, file).split(path.sep)[0] !== "..";
      }
      return /\/(?:海报|封面|角色|人物|头像)[^/]*\//.test(normalized)
        || /海报|封面|角色|人物|头像/.test(path.basename(file));
    })
    .slice(0, MAX_IMAGE_CANDIDATES);

  let remainingCharacters = MAX_TOTAL_TEXT_CHARACTERS;
  const textFiles = files
    .filter((file) => textExtensions.has(path.extname(file).toLowerCase()))
    .sort((left, right) => left.localeCompare(right, "zh-CN", { numeric: true }))
    .slice(0, MAX_TEXT_FILES);
  const texts: MetadataInputs["texts"] = [];
  for (const file of textFiles) {
    if (remainingCharacters <= 0) break;
    const content = decodeText(await readFile(file)).replace(/\0/g, "").trim();
    if (!content) continue;
    const clipped = content.slice(0, remainingCharacters);
    remainingCharacters -= clipped.length;
    texts.push({
      fileName: path.basename(file),
      relativePath: path.relative(resourceDir, file),
      content: clipped,
    });
  }

  return {
    images: imageFiles.map((file, index) => ({
      id: `image-${index + 1}`,
      file,
      fileName: path.basename(file),
      relativePath: path.relative(resourceDir, file),
    })),
    texts,
  };
}

export function douyinTaskNeedsNetdiskMetadata(task: ClaimedDouyinDramaTask) {
  return task.playlet.summary.trim().length <= 100
    || task.playlet.roles.length < 2
    || task.playlet.roles.some((role) => !role.roleType || !role.intro || !role.photoFile);
}

function mergeRoles(
  supplied: DouyinDramaRole[],
  generated: z.infer<typeof aiRoleSchema>[],
  images: MetadataImage[],
) {
  const imageForRole = (role: z.infer<typeof aiRoleSchema> | undefined) => {
    const photoImageId = role?.photoImageId?.trim();
    const selectedByAi = photoImageId
      ? images.find((image) => image.id === photoImageId)
      : undefined;
    if (selectedByAi) return selectedByAi;
    if (!role?.name) return undefined;
    const normalizedRoleName = role.name.replace(/[\s·•:：_-]/g, "").toLowerCase();
    return images.find((image) => {
      const normalizedFileName = path.parse(image.fileName).name
        .replace(/-\d+$/, "")
        .replace(/[\s·•:：_-]/g, "")
        .toLowerCase();
      return normalizedRoleName.length >= 2 && normalizedFileName.includes(normalizedRoleName);
    });
  };
  const generatedByName = new Map(generated.map((role) => [role.name, role]));
  const backendProvidedRoles = supplied.length >= 2;
  const source: DouyinDramaRole[] = supplied.length >= 2
    ? supplied
    : generated.map((role) => ({
        name: role.name,
        roleType: role.roleType,
        intro: role.intro,
      }));
  return source.slice(0, 10).map((role, index) => {
    const generatedRole = generatedByName.get(role.name) ?? generated[index];
    const matchedImage = imageForRole(generatedRole);
    return {
      ...role,
      roleType: role.roleType ?? generatedRole?.roleType ?? (index === 0 ? "主角" : "配角"),
      intro: role.intro ?? generatedRole?.intro ?? `${role.name}是本剧重要角色。`,
      photoFile: role.photoFile ?? matchedImage?.file,
    } satisfies DouyinDramaRole;
  }).filter((role) => backendProvidedRoles || Boolean(role.photoFile));
}

function buildPrompt(task: ClaimedDouyinDramaTask, inputs: MetadataInputs) {
  return [
    "请一次性整理抖音漫剧提报所需的简介和角色资料，只输出 JSON 对象，不要 Markdown。",
    "JSON 格式：{\"summary\":\"...\",\"roles\":[{\"name\":\"...\",\"roleType\":\"主角|配角|参演\",\"intro\":\"...\",\"photoImageId\":\"image-1或null\"}]}。",
    "规则：summary 必须为 101-200 个中文字符，忠于资料，不虚构关键剧情；每个角色简介不超过100字。",
    "角色必须能在图片候选中明确匹配到单人头像，并填写对应 photoImageId；只返回有头像的角色，至少2个、最多10个。不要把封面、海报、横图、竖图当成角色头像，也不要虚构角色或图片。",
    "后端已提供的简介和角色属于权威信息，应保留事实并补全缺项。所有角色和简介在这一次响应中同时完成。",
    `剧名：${task.playlet.title}`,
    `后端简介：${task.playlet.summary || "（未提供）"}`,
    `后端角色：${JSON.stringify(task.playlet.roles)}`,
    `TXT资料：${JSON.stringify(inputs.texts.map((text) => ({
      fileName: text.fileName,
      relativePath: text.relativePath,
      content: text.content,
    })))}`,
    `图片候选：${JSON.stringify(inputs.images.map((image) => ({
      imageId: image.id,
      fileName: image.fileName,
      relativePath: image.relativePath,
    })))}`,
  ].join("\n");
}

export async function enrichDouyinTaskFromNetdisk(
  task: ClaimedDouyinDramaTask,
  options: DouyinDramaRuntimeOptions,
): Promise<ClaimedDouyinDramaTask> {
  if (!douyinTaskNeedsNetdiskMetadata(task)) return task;
  const root = options.localEpisodeVideoRoot?.trim();
  if (!root) throw new Error("DOUYIN_DRAMA_LOCAL_VIDEO_ROOT_REQUIRED");
  const resourceDir = path.join(root, task.originalTitle.trim());
  const inputs = await collectDouyinNetdiskMetadataInputs(resourceDir);
  if (task.playlet.summary.trim().length <= 100 && inputs.texts.length === 0) {
    throw new Error("DOUYIN_DRAMA_NETDISK_TEXT_REQUIRED: 后端未提供合格简介，网盘素材中也没有找到可读取的 TXT 文件");
  }
  if (!options.aiClientFactory) {
    throw new Error("DOUYIN_DRAMA_AI_CLIENT_REQUIRED: 网盘简介和角色资料需要全局 AI 配置");
  }

  log(options, "[douyin-drama] 开始一次性 AI 整理网盘简介、角色资料和头像文件名。", {
    accountTaskId: task.accountTaskId,
    textFiles: inputs.texts.map((text) => text.relativePath),
    imageCandidates: inputs.images.map((image) => image.relativePath),
  }, "metadata");
  const completion = await options.aiClientFactory().generateText({
    systemPrompt: "你是短剧资料整理助手。严格基于输入资料输出合法 JSON，不解释、不追加文字。",
    prompt: buildPrompt(task, inputs),
    maxTokens: 2_000,
    temperature: 0.1,
  });
  const generated = aiMetadataSchema.parse(parseAiJsonObject(completion.text));
  const summary = task.playlet.summary.trim().length > 100
    ? task.playlet.summary.trim()
    : generated.summary;
  const roles = mergeRoles(task.playlet.roles, generated.roles, inputs.images);
  if (summary.length <= 100) {
    throw new Error(`DOUYIN_DRAMA_AI_SUMMARY_TOO_SHORT: AI 整理后的简介需要多于100字，实际=${summary.length}`);
  }
  if (roles.length < 2) {
    throw new Error(
      `DOUYIN_DRAMA_ROLE_PHOTO_REQUIRED: 网盘中至少需要找到2个可与角色姓名匹配的角色图片，实际=${roles.length}`,
    );
  }
  const rolesWithoutPhoto = roles.filter((role) => !role.photoFile);
  if (rolesWithoutPhoto.length > 0) {
    throw new Error(
      `DOUYIN_DRAMA_ROLE_PHOTO_REQUIRED: 网盘中找不到角色图片：${rolesWithoutPhoto.map((role) => role.name).join("、")}`,
    );
  }
  task.playlet.summary = summary.slice(0, 200);
  task.playlet.roles = roles;
  log(options, "[douyin-drama] 网盘元数据整理完成（单次 AI 调用）。", {
    accountTaskId: task.accountTaskId,
    model: completion.model,
    summaryLength: task.playlet.summary.length,
    roles: roles.map((role) => ({ name: role.name, roleType: role.roleType, photoFile: role.photoFile })),
    usage: completion.usage,
  }, "metadata");
  return task;
}
