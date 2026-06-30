import {
  chromium,
  type BrowserContext,
  type Page,
} from "playwright";
import {
  KUAISHOU_DRAMA_PLATFORM,
} from "../shared/constants.js";
import { parseTaskConfig } from "../shared/task-config.js";
import type {
  KuaishouDramaRuntime,
  KuaishouDramaRuntimeOptions,
  KuaishouDramaRuntimeStatus,
} from "../shared/types.js";
import {
  cleanupOldLogFiles,
  loginStateFromUrl,
  log,
  saveCredentialState,
} from "../automation/browser-session.js";
import { runPublishTask } from "../automation/publish-runner.js";

export async function startKuaishouDramaRuntime(
  options: KuaishouDramaRuntimeOptions = {},
): Promise<KuaishouDramaRuntime> {
  if (!options.userDataDir) {
    throw new Error("Kuaishou drama userDataDir is required.");
  }

  const taskConfig = parseTaskConfig(options);
  const userDataDir = options.userDataDir;
  let running = true;
  let page: Page | null = null;
  let context: BrowserContext | null = null;

  await cleanupOldLogFiles(options).catch(() => undefined);
  log(options, "[kuaishou-drama] starting browser");
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: options.config?.browser?.headless ?? false,
    slowMo: options.config?.browser?.slowMo ?? 0,
  });
  context.on("close", () => {
    running = false;
  });

  page = context.pages()[0] ?? (await context.newPage());

  void runPublishTask(context, page, options, taskConfig).catch((error) => {
    log(
      options,
      `[kuaishou-drama] task failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  return {
    getStatus(): KuaishouDramaRuntimeStatus {
      const activeUrl = page?.url();
      return {
        platform: KUAISHOU_DRAMA_PLATFORM,
        running,
        loginState: loginStateFromUrl(activeUrl),
        activeUrl,
        userDataDir,
        accountProfileName: options.accountProfileName,
        accountDir: options.accountDir,
        credentialStatePath: options.credentialStatePath,
        assetDownloadDir: options.assetDownloadDir,
        logFilePath: options.logFilePath,
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
