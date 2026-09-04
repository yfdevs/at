export type LlamaServerState =
  | "idle"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";

export type LlamaServerErrorCode =
  | "LLAMA_SERVER_BUNDLED_RUNTIME_MISSING"
  | "LLAMA_SERVER_EXECUTABLE_NOT_FOUND"
  | "LLAMA_SERVER_MODEL_NOT_FOUND"
  | "LLAMA_SERVER_MM_PROJ_NOT_FOUND"
  | "LLAMA_SERVER_INVALID_OPTION"
  | "LLAMA_SERVER_START_FAILED"
  | "LLAMA_SERVER_START_TIMEOUT"
  | "LLAMA_SERVER_UNSUPPORTED_PLATFORM";

export interface LlamaServerLogger {
  debug?: (message: string, fields?: Record<string, unknown>) => void;
  info?: (message: string, fields?: Record<string, unknown>) => void;
  warn?: (message: string, fields?: Record<string, unknown>) => void;
  error?: (message: string, fields?: Record<string, unknown>) => void;
}

export interface LlamaServerLogEvent {
  message: string;
  source: "stdout" | "stderr";
}

export interface LlamaServerOptions {
  /** Absolute or current-working-directory-relative path to llama-server(.exe). */
  executablePath: string;
  /** Absolute or current-working-directory-relative path to a GGUF model. */
  modelPath: string;
  /** Arguments for a launcher executable, placed before llama-server arguments. */
  launcherArguments?: readonly string[];
  /** Extra llama-server arguments. Managed model/host/port flags cannot be repeated. */
  additionalArguments?: readonly string[];
  apiKey?: string;
  contextSize?: number;
  cwd?: string;
  gpuLayers?: number;
  host?: string;
  logger?: LlamaServerLogger;
  modelAlias?: string;
  /** Optional multimodal projector GGUF used by vision-language models. */
  multimodalProjectorPath?: string;
  onLog?: (event: LlamaServerLogEvent) => void;
  port?: number;
  shutdownTimeoutMs?: number;
  startupTimeoutMs?: number;
  threads?: number;
}

export interface LlamaServerConnection {
  /** Root server URL, for example http://127.0.0.1:8080. */
  baseURL: string;
  /** OpenAI-compatible API URL, for example http://127.0.0.1:8080/v1. */
  openAiBaseURL: string;
  /** Non-empty value suitable for OpenAI SDKs when server auth is disabled. */
  apiKey: string;
  model: string;
}

export type LlamaServerHealth =
  | { status: "ready"; statusCode: 200 }
  | { status: "loading"; statusCode: number; detail?: string }
  | { status: "unreachable"; detail: string };
