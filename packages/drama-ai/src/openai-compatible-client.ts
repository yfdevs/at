import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

import { resolveImageDataUrl } from "./image-input.js";
import type {
  AiCompletionResult,
  AiGenerationOptions,
  DramaAiClient,
  ImageAnalysisOptions,
  OpenAiCompatibleClientOptions,
  TextGenerationOptions,
} from "./types.js";

export const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = "https://api.openai.com/v1";

function requiredValue(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

function validateGenerationOptions(options: AiGenerationOptions): void {
  if (options.maxTokens !== undefined && options.maxTokens <= 0) {
    throw new Error("DRAMA_AI_MAX_TOKENS_INVALID");
  }
  if (
    options.temperature !== undefined &&
    (options.temperature < 0 || options.temperature > 2)
  ) {
    throw new Error("DRAMA_AI_TEMPERATURE_INVALID");
  }
}

function completionResult(completion: ChatCompletion, requestId?: string): AiCompletionResult {
  const choice = completion.choices[0];
  if (!choice) throw new Error("DRAMA_AI_RESPONSE_CHOICE_MISSING");

  const text = choice.message.content?.trim();
  if (!text) throw new Error("DRAMA_AI_RESPONSE_TEXT_MISSING");

  return {
    finishReason: choice.finish_reason,
    model: completion.model,
    requestId,
    text,
    usage: completion.usage
      ? {
          inputTokens: completion.usage.prompt_tokens,
          outputTokens: completion.usage.completion_tokens,
          totalTokens: completion.usage.total_tokens,
        }
      : undefined,
  };
}

export class OpenAiCompatibleClient implements DramaAiClient {
  readonly baseURL: string;
  readonly model: string;
  private readonly sdk: OpenAI;

  constructor(options: OpenAiCompatibleClientOptions) {
    const apiKey = requiredValue(options.apiKey, "DRAMA_AI_API_KEY_REQUIRED");
    this.model = requiredValue(options.model, "DRAMA_AI_MODEL_REQUIRED");
    this.baseURL = requiredValue(
      options.baseURL ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
      "DRAMA_AI_BASE_URL_REQUIRED",
    ).replace(/\/+$/, "");

    this.sdk = new OpenAI({
      apiKey,
      baseURL: this.baseURL,
      maxRetries: options.maxRetries ?? 2,
      timeout: options.timeoutMs ?? 60_000,
    });
  }

  async generateText(options: TextGenerationOptions): Promise<AiCompletionResult> {
    validateGenerationOptions(options);
    const prompt = requiredValue(options.prompt, "DRAMA_AI_PROMPT_REQUIRED");
    const messages: ChatCompletionMessageParam[] = [];
    const systemPrompt = options.systemPrompt?.trim();
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });

    const { data: completion, request_id: requestId } =
      await this.sdk.chat.completions
        .create({
          model: options.model?.trim() || this.model,
          messages,
          max_tokens: options.maxTokens,
          temperature: options.temperature,
        })
        .withResponse();
    return completionResult(completion, requestId ?? undefined);
  }

  async analyzeImages(options: ImageAnalysisOptions): Promise<AiCompletionResult> {
    validateGenerationOptions(options);
    const prompt = requiredValue(options.prompt, "DRAMA_AI_PROMPT_REQUIRED");
    if (options.images.length === 0) throw new Error("DRAMA_AI_IMAGE_REQUIRED");

    const resolvedImages = await Promise.all(
      options.images.map(async (image): Promise<ChatCompletionContentPart> => ({
        type: "image_url",
        image_url: {
          url: await resolveImageDataUrl(image),
          ...(image.detail ? { detail: image.detail } : {}),
        },
      })),
    );
    const content: ChatCompletionContentPart[] = [
      { type: "text", text: prompt },
      ...resolvedImages,
    ];
    const messages: ChatCompletionMessageParam[] = [];
    const systemPrompt = options.systemPrompt?.trim();
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content });

    const { data: completion, request_id: requestId } =
      await this.sdk.chat.completions
        .create({
          model: options.model?.trim() || this.model,
          messages,
          max_tokens: options.maxTokens,
          temperature: options.temperature,
        })
        .withResponse();
    return completionResult(completion, requestId ?? undefined);
  }
}

export function createOpenAiCompatibleClient(
  options: OpenAiCompatibleClientOptions,
): OpenAiCompatibleClient {
  return new OpenAiCompatibleClient(options);
}
