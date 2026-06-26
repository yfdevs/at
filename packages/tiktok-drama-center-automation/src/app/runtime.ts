import {
  chromium,
  type BrowserContext,
  type Page,
} from "playwright";
import { TIKTOK_DRAMA_CENTER_PLATFORM } from "../shared/constants.js";
import type {
  TiktokDramaCenterRuntime,
  TiktokDramaCenterRuntimeOptions,
  TiktokDramaCenterRuntimeStatus,
} from "../shared/types.js";
import {
  loginStateFromUrl,
  log,
  saveCredentialState,
} from "../automation/browser-session.js";

export async function startTiktokDramaCenterRuntime(
  options: TiktokDramaCenterRuntimeOptions = {},
): Promise<TiktokDramaCenterRuntime> {
  if (!options.userDataDir) {
    throw new Error("TikTok Drama Center userDataDir is required.");
  }

  const userDataDir = options.userDataDir;
  let running = true;
  let page: Page | null = null;
  let context: BrowserContext | null = null;

  log(options, "[tiktok-drama-center] starting browser");
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: options.config?.browser?.headless ?? false,
    slowMo: options.config?.browser?.slowMo ?? 20,
  });
  context.on("close", () => {
    running = false;
  });

  page = context.pages()[0] ?? (await context.newPage());
  log(options, "[tiktok-drama-center] runtime ready; business flow is not implemented yet");

  return {
    getStatus(): TiktokDramaCenterRuntimeStatus {
      const activeUrl = page?.url();
      return {
        platform: TIKTOK_DRAMA_CENTER_PLATFORM,
        running,
        loginState: loginStateFromUrl(activeUrl),
        activeUrl,
        userDataDir,
      };
    },
    async stop() {
      if (context) {
        await saveCredentialState(context, options).catch(() => undefined);
      }
      running = false;
      await context?.close();
      log(options, "[tiktok-drama-center] runtime stopped");
    },
  };
}
