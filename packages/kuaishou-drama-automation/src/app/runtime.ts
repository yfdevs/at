import {
  chromium,
  type BrowserContext,
  type Page,
} from "playwright";
import { KUAISHOU_DRAMA_PLATFORM } from "../shared/constants.js";
import type {
  KuaishouDramaRuntime,
  KuaishouDramaRuntimeOptions,
  KuaishouDramaRuntimeStatus,
} from "../shared/types.js";
import {
  loginStateFromUrl,
  log,
  saveCredentialState,
} from "../automation/browser-session.js";

export async function startKuaishouDramaRuntime(
  options: KuaishouDramaRuntimeOptions = {},
): Promise<KuaishouDramaRuntime> {
  if (!options.userDataDir) {
    throw new Error("Kuaishou drama userDataDir is required.");
  }

  const userDataDir = options.userDataDir;
  let running = true;
  let page: Page | null = null;
  let context: BrowserContext | null = null;

  log(options, "[kuaishou-drama] starting browser");
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: options.config?.browser?.headless ?? false,
    slowMo: options.config?.browser?.slowMo ?? 20,
  });
  context.on("close", () => {
    running = false;
  });

  page = context.pages()[0] ?? (await context.newPage());
  log(options, "[kuaishou-drama] runtime ready; business flow is not implemented yet");

  return {
    getStatus(): KuaishouDramaRuntimeStatus {
      const activeUrl = page?.url();
      return {
        platform: KUAISHOU_DRAMA_PLATFORM,
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
      log(options, "[kuaishou-drama] runtime stopped");
    },
  };
}
