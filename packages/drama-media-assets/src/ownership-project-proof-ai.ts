import { analyzeImagesAsJson, type DramaAiClient } from "@drama/ai";
import sharp from "sharp";

export type OwnershipProjectProofAiKind = "jianying" | "juchuang" | "unknown";

const minimumScreenshotAspectRatio = 1.5;

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

function readHasJianying(data: Record<string, unknown>) {
  if (typeof data.hasJianying !== "boolean") {
    throw new Error("OWNERSHIP_PROJECT_PROOF_AI_RESPONSE_INVALID");
  }
  return data.hasJianying;
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
  if (!width || !height || width / height < minimumScreenshotAspectRatio) return "unknown";

  const image = await prepareTopLeftImage(file, width, height);
  try {
    const completion = await analyzeImagesAsJson(aiClient, {
      images: [{
        type: "data-url",
        dataUrl: `data:image/jpeg;base64,${image.toString("base64")}`,
        detail: "high",
      }],
      prompt: [
        "判断这张工程软件截图的左上角是否明确出现中文品牌文字“剪映”，或对应的 Jianying/CapCut 标志。",
        "只能根据图片中实际可见的文字或标志判断，不要根据界面颜色、布局和按钮样式猜测。",
        "没有看到、文字模糊、无法确认，或者显示的是其他软件时，hasJianying 必须为 false。",
        "只返回 JSON 对象，不要解释。格式：{\"hasJianying\":true}",
      ].join("\n"),
      systemPrompt: "你是严格的图片文字识别器，只输出用户指定结构的 JSON 对象。",
      maxTokens: 80,
      temperature: 0,
    });
    return readHasJianying(completion.data) ? "jianying" : "juchuang";
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `[ownership-project-proof-ai-failed] 无法使用云 AI 识别权属工程截图左上角：${file}；${detail}`,
    );
  }
}
