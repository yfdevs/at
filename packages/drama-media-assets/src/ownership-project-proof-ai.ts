import { analyzeImagesAsJson, type DramaAiClient } from "@drama/ai";
import sharp from "sharp";

export type OwnershipProjectProofAiKind = "jianying" | "juchuang" | "unknown";

async function prepareTopLeftImage(file: string, width: number, height: number) {
  const regionWidth = Math.min(width, Math.max(360, Math.round(width * 0.25)));
  const regionHeight = Math.min(height, Math.max(140, Math.round(height * 0.18)));
  return sharp(file, { failOn: "error" })
    .rotate()
    .extract({ left: 0, top: 0, width: regionWidth, height: regionHeight })
    .resize({ width: 1_200, withoutEnlargement: false })
    .flatten({ background: "white" })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

async function prepareFullImage(file: string) {
  return sharp(file, { failOn: "error" })
    .rotate()
    .resize({ width: 1_600, height: 1_200, fit: "inside", withoutEnlargement: false })
    .flatten({ background: "white" })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

async function prepareWorkspaceIdentityImage(file: string, width: number, height: number) {
  const left = Math.max(0, Math.round(width * 0.2));
  const top = Math.max(0, Math.round(height * 0.38));
  const regionWidth = Math.max(1, Math.min(width - left, Math.round(width * 0.65)));
  const regionHeight = Math.max(1, Math.min(height - top, Math.round(height * 0.55)));
  return sharp(file, { failOn: "error" })
    .rotate()
    .extract({ left, top, width: regionWidth, height: regionHeight })
    .resize({ width: 1_600, withoutEnlargement: false })
    .flatten({ background: "white" })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

function readProofKind(data: Record<string, unknown>): OwnershipProjectProofAiKind {
  if (data.kind !== "jianying" && data.kind !== "juchuang" && data.kind !== "unknown") {
    throw new Error("OWNERSHIP_PROJECT_PROOF_AI_RESPONSE_INVALID");
  }
  return data.kind;
}

export async function classifyOwnershipProjectProofScreenshotWithAi(
  file: string,
  aiClient: DramaAiClient,
): Promise<OwnershipProjectProofAiKind> {
  const metadata = await sharp(file, { failOn: "error" }).metadata();
  if (!metadata.width || !metadata.height) return "unknown";

  const swapsOrientation = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
  const width = swapsOrientation ? metadata.height : metadata.width;
  const height = swapsOrientation ? metadata.width : metadata.height;
  if (!width || !height) return "unknown";

  const [fullImage, topLeftImage, workspaceIdentityImage] = await Promise.all([
    prepareFullImage(file),
    prepareTopLeftImage(file, width, height),
    prepareWorkspaceIdentityImage(file, width, height),
  ]);
  try {
    const completion = await analyzeImagesAsJson(aiClient, {
      images: [fullImage, topLeftImage, workspaceIdentityImage].map((image) => ({
        type: "data-url" as const,
        dataUrl: `data:image/jpeg;base64,${image.toString("base64")}`,
        detail: "high" as const,
      })),
      prompt: [
        "识别权属工程软件截图来源。第 1 张是完整截图，第 2 张是左上角放大区域，第 3 张是工作区中下部放大区域。",
        "kind=jianying：明确看到“剪映”、Jianying、CapCut 标志，或能可靠确认是剪映工程编辑界面。",
        "kind=juchuang：明确看到“剧创”“即梦”、Juchuang、Jimeng、Dreamina 标志，或能可靠确认是对应工程编辑界面。",
        "若画面是可编辑的 AI 分镜/视频生成工程工作区，并显示 Seedance（例如 Seedance 2.0 Fast VIP）或 Seedream 模型，也归为 kind=juchuang。常见特征包括节点连线画布、角色/图片参考、镜号分镜提示词、视频生成参数或模型选择器。",
        "LiblibTV、LiblibAI 等平台的可编辑 AI 视频生成画布，若同时具有分镜节点、提示词、模型或视频参数，也按上述 AI 剧创工程截图识别；仅有生成结果预览或平台名称不够。",
        "仅在普通网页、宣传页或成品画面中偶然出现 Seedance/Seedream 文字，不足以判为工程截图。",
        "kind=unknown：不是工程软件截图、文字过于模糊、两种来源都无法可靠确认，或证据互相冲突。",
        "不能因为没有看到剪映就自动判为剧创，也不要根据文件名判断。",
        "只返回 JSON 对象，不要解释。格式：{\"kind\":\"jianying\",\"evidence\":\"左上角可见剪映标志\"}",
      ].join("\n"),
      systemPrompt: "你是工程软件截图来源识别器，只输出用户指定结构的 JSON 对象。",
      maxTokens: 120,
      temperature: 0,
    });
    return readProofKind(completion.data);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `[ownership-project-proof-ai-failed] 无法使用云 AI 识别权属工程截图界面：${file}；${detail}`,
    );
  }
}
