export type AiImageDetail = "auto" | "low" | "high";

export type AiImageInput =
  | {
      type: "url";
      url: string;
      detail?: AiImageDetail;
    }
  | {
      type: "file";
      path: string;
      mimeType?: string;
      detail?: AiImageDetail;
    }
  | {
      type: "data-url";
      dataUrl: string;
      detail?: AiImageDetail;
    };

export interface OpenAiCompatibleClientOptions {
  apiKey: string;
  model: string;
  baseURL?: string;
  maxRetries?: number;
  timeoutMs?: number;
}

export type DoubaoClientOptions = OpenAiCompatibleClientOptions;

export interface AiGenerationOptions {
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface TextGenerationOptions extends AiGenerationOptions {
  prompt: string;
}

export interface ImageAnalysisOptions extends AiGenerationOptions {
  images: readonly AiImageInput[];
  prompt: string;
}

export interface AiTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AiCompletionResult {
  finishReason: string | null;
  model: string;
  requestId?: string;
  text: string;
  usage?: AiTokenUsage;
}

export interface AiJsonCompletionResult extends AiCompletionResult {
  data: Record<string, unknown>;
}

export interface DramaAiClient {
  analyzeImages(options: ImageAnalysisOptions): Promise<AiCompletionResult>;
  generateText(options: TextGenerationOptions): Promise<AiCompletionResult>;
}
