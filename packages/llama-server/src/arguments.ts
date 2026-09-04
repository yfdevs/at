import path from "node:path";
import type { LlamaServerOptions } from "./types.js";
import { LlamaServerError } from "./errors.js";

const MANAGED_ARGUMENTS = new Set([
  "-m",
  "--model",
  "--host",
  "--port",
  "--alias",
  "-c",
  "--ctx-size",
  "-ngl",
  "--gpu-layers",
  "--n-gpu-layers",
  "--api-key",
  "--mmproj",
  "-t",
  "--threads",
]);

function assertIntegerOption(
  label: string,
  value: number | undefined,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new LlamaServerError(
      "LLAMA_SERVER_INVALID_OPTION",
      `${label} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
}

function assertAdditionalArguments(arguments_: readonly string[]): void {
  for (const argument of arguments_) {
    const flag = argument.split("=", 1)[0];
    if (MANAGED_ARGUMENTS.has(flag)) {
      throw new LlamaServerError(
        "LLAMA_SERVER_INVALID_OPTION",
        `additionalArguments cannot override managed option ${flag}.`,
      );
    }
  }
}

export function buildLlamaServerArguments(
  options: LlamaServerOptions,
  resolvedModelPath = options.modelPath,
): string[] {
  const host = options.host?.trim() || "127.0.0.1";
  const port = options.port ?? 8080;
  const additionalArguments = options.additionalArguments ?? [];

  if (/^https?:\/\//i.test(host) || /[/?#]/.test(host)) {
    throw new LlamaServerError(
      "LLAMA_SERVER_INVALID_OPTION",
      "host must be a hostname or IP address without a URL scheme or path.",
    );
  }
  assertIntegerOption("port", port, 1, 65_535);
  assertIntegerOption("contextSize", options.contextSize, 1);
  assertIntegerOption("gpuLayers", options.gpuLayers, 0);
  assertIntegerOption("threads", options.threads, 1);
  assertIntegerOption("startupTimeoutMs", options.startupTimeoutMs, 1);
  assertIntegerOption("shutdownTimeoutMs", options.shutdownTimeoutMs, 1);
  assertAdditionalArguments(additionalArguments);

  const arguments_ = ["--model", resolvedModelPath, "--host", host, "--port", String(port)];
  const modelAlias = options.modelAlias?.trim()
    || path.basename(resolvedModelPath, path.extname(resolvedModelPath));
  const apiKey = options.apiKey?.trim();

  if (modelAlias) arguments_.push("--alias", modelAlias);
  if (options.contextSize !== undefined) arguments_.push("--ctx-size", String(options.contextSize));
  if (options.gpuLayers !== undefined) arguments_.push("--n-gpu-layers", String(options.gpuLayers));
  if (options.threads !== undefined) arguments_.push("--threads", String(options.threads));
  if (options.multimodalProjectorPath) {
    arguments_.push("--mmproj", options.multimodalProjectorPath);
  }
  if (apiKey) arguments_.push("--api-key", apiKey);

  arguments_.push(...additionalArguments);
  return arguments_;
}
