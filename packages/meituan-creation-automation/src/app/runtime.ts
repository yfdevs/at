import {
  chromium,
  type BrowserContext,
  type Page,
} from "playwright";
import {
  MEITUAN_CREATION_LOGIN_URL,
  MEITUAN_CREATION_PUBLISH_VIDEO_URL,
} from "../shared/constants.js";
import { validateLocalEpisodeVideos } from "../shared/local-episode-videos.js";
import { parseTaskConfig } from "../shared/task-config.js";
import type {
  MeituanCreationRuntime,
  MeituanCreationRuntimeOptions,
  MeituanCreationRuntimeStatus,
} from "../shared/types.js";
import { loginStateFromUrl, log, saveCredentialState } from "../automation/browser-session.js";
import { runPublishTask } from "../automation/publish-runner.js";

export async function startMeituanCreationRuntime(
  options: MeituanCreationRuntimeOptions = {},
): Promise<MeituanCreationRuntime> {
  if (!options.userDataDir) {
    throw new Error("Meituan creation userDataDir is required.");
  }

  const taskConfig = parseTaskConfig(options);
  if (taskConfig) {
    await validateLocalEpisodeVideos(taskConfig, options.config?.localEpisodeVideoRoot);
  }

  const userDataDir = options.userDataDir;
  let running = true;
  let page: Page | null = null;
  let context: BrowserContext | null = null;

  log(options, "[meituan-creation] starting browser");
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: options.config?.browser?.headless ?? false,
    slowMo: options.config?.browser?.slowMo ?? 20,
  });
  context.on("close", () => {
    running = false;
  });
  page = context.pages()[0] ?? (await context.newPage());

  void runPublishTask(context, page, options, taskConfig).catch((error) => {
    log(
      options,
      `[meituan-creation] task failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  return {
    getStatus(): MeituanCreationRuntimeStatus {
      const activeUrl = page?.url();
      return {
        platform: "meituan-creation",
        loginUrl: MEITUAN_CREATION_LOGIN_URL,
        publishVideoUrl: MEITUAN_CREATION_PUBLISH_VIDEO_URL,
        running,
        loginState: activeUrl ? loginStateFromUrl(activeUrl) : "unknown",
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
      log(options, "[meituan-creation] runtime skeleton stopped");
    },
  };
}
