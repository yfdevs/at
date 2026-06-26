import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { BrowserContext } from "playwright";
import type {
  TiktokDramaCenterLoginState,
  TiktokDramaCenterRuntimeOptions,
} from "../shared/types.js";

export function log(options: TiktokDramaCenterRuntimeOptions, message: string) {
  options.onLog?.(message);
}

export function loginStateFromUrl(url: string | undefined): TiktokDramaCenterLoginState {
  if (!url || url === "about:blank") return "unknown";
  return url.includes("login") ? "login-required" : "logged-in";
}

export async function saveCredentialState(
  context: BrowserContext,
  options: TiktokDramaCenterRuntimeOptions,
) {
  if (!options.credentialStatePath) {
    return;
  }

  await mkdir(dirname(options.credentialStatePath), { recursive: true });
  await context.storageState({ path: options.credentialStatePath });
  log(options, `[tiktok-drama-center] credential state saved: ${options.credentialStatePath}`);
}
