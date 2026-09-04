import { access } from "node:fs/promises";
import path from "node:path";
import { LlamaServerError } from "./errors.js";

export interface BundledLlamaServerPathOptions {
  appRoot: string;
  isPackaged: boolean;
  resourcesPath: string;
  platform?: NodeJS.Platform;
  arch?: string;
}

export function resolveBundledLlamaServerDirectory(options: BundledLlamaServerPathOptions): string {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  if (platform !== "win32" || arch !== "x64") {
    throw new LlamaServerError(
      "LLAMA_SERVER_UNSUPPORTED_PLATFORM",
      `Bundled llama.cpp runtime supports Windows x64 only; received ${platform}/${arch}.`,
    );
  }

  return options.isPackaged
    ? path.join(options.resourcesPath, "llama-server", "win-x64")
    : path.join(options.appRoot, "packages", "llama-server", "vendor", "win-x64");
}

export function resolveBundledLlamaServerExecutable(options: BundledLlamaServerPathOptions): string {
  return path.join(resolveBundledLlamaServerDirectory(options), "llama-server.exe");
}

export async function assertBundledLlamaServerRuntime(
  options: BundledLlamaServerPathOptions,
): Promise<string> {
  const executablePath = resolveBundledLlamaServerExecutable(options);
  try {
    await access(executablePath);
  } catch (error) {
    throw new LlamaServerError(
      "LLAMA_SERVER_BUNDLED_RUNTIME_MISSING",
      `Bundled llama.cpp runtime is missing: ${executablePath}`,
      { cause: error },
    );
  }
  return executablePath;
}
