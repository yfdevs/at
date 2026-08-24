import {
  chromium,
  type BrowserContext,
  type Page,
} from "playwright";
import { isNonRetryableBaiduNetdiskResourceError } from "@drama/drama-media-assets";
import {
  KUAISHOU_DRAMA_PLATFORM,
} from "../shared/constants.js";
import { parseTaskConfig } from "../shared/task-config.js";
import type {
  ClaimedKuaishouDramaTask,
  KuaishouDramaRuntime,
  KuaishouDramaRuntimeOptions,
  KuaishouDramaRuntimeStatus,
  KuaishouDramaTaskConfig,
} from "../shared/types.js";
import {
  cleanupOldLogFiles,
  loginStateFromUrl,
  log,
  saveCredentialState,
} from "../automation/browser-session.js";
import { runPublishTask } from "../automation/publish-runner.js";
import {
  getKuaishouDramaLocalEpisodeVideoRoot,
  validateKuaishouDramaLocalEpisodeVideos,
} from "../shared/local-episode-videos.js";

const baiduNetdiskRetryDelayMs = 5_000;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function ensureBaiduNetdiskResourceReady(
  task: KuaishouDramaTaskConfig,
  resourceName: string,
  accountTaskId: number | undefined,
  options: KuaishouDramaRuntimeOptions,
) {
  const shareText = task.baiduPanResourceLink?.trim();
  if (!shareText) {
    log(options, "[kuaishou-drama] task has no baidu netdisk resource; download check skipped");
    return;
  }
  if (!/https?:\/\/pan\.baidu\.com\/s\//i.test(shareText)) {
    throw new Error("分享文本中没有找到百度网盘链接。");
  }
  if (!options.ensureBaiduNetdiskResource) {
    throw new Error("任务包含百度网盘资源链接，但当前快手运行时未接入百度网盘下载能力。");
  }

  const localEpisodeVideoRoot = getKuaishouDramaLocalEpisodeVideoRoot(options);
  const retryAttempts = Math.max(0, options.baiduNetdiskDownloadRetryAttempts ?? 3);
  const maxAttempts = retryAttempts + 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      log(
        options,
        `[kuaishou-drama] ensuring baidu netdisk resource: ` +
          `accountTaskId=${accountTaskId ?? "configured"} resourceName=${resourceName} ` +
          `episodeCount=${task.episodeCount} attempt=${attempt}/${maxAttempts}`,
      );
      await options.ensureBaiduNetdiskResource({
        shareText,
        resourceName,
        localEpisodeVideoRoot,
        episodeCount: task.episodeCount,
      });
      await validateKuaishouDramaLocalEpisodeVideos(task, resourceName, options);
      log(
        options,
        `[kuaishou-drama] baidu netdisk resource ready: ` +
          `resourceName=${resourceName} episodes=${task.episodeCount}`,
      );
      return;
    } catch (error) {
      lastError = error;
      const message = errorMessage(error);
      const nonRetryable = isNonRetryableBaiduNetdiskResourceError(error);
      if (nonRetryable || attempt >= maxAttempts) break;
      log(
        options,
        `[kuaishou-drama] baidu netdisk resource failed, retrying: ` +
          `attempt=${attempt}/${maxAttempts} error=${message}`,
      );
      await new Promise((resolve) => setTimeout(resolve, baiduNetdiskRetryDelayMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function startKuaishouDramaRuntime(
  options: KuaishouDramaRuntimeOptions = {},
): Promise<KuaishouDramaRuntime> {
  if (!options.userDataDir) {
    throw new Error("Kuaishou drama userDataDir is required.");
  }

  const configuredTask = parseTaskConfig(options);
  const userDataDir = options.userDataDir;
  let running = true;
  let page: Page | null = null;
  let context: BrowserContext | null = null;
  let claimedTaskForReporting: Pick<ClaimedKuaishouDramaTask, "accountTaskId"> | null = null;

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

  const resolveTask = async () => {
    if (configuredTask) {
      await ensureBaiduNetdiskResourceReady(
        configuredTask,
        configuredTask.title,
        undefined,
        options,
      );
      return { taskConfig: configuredTask, resourceName: configuredTask.title };
    }
    if (!options.claimTask) return null;

    log(options, "[kuaishou-drama] authenticated, claiming next task");
    const claimedTask = await options.claimTask();
    if (!claimedTask) return null;
    const isClaimedTask = "accountTaskId" in claimedTask && "task" in claimedTask;
    const taskInput = isClaimedTask
      ? (() => {
          claimedTaskForReporting = { accountTaskId: claimedTask.accountTaskId };
          return claimedTask.task;
        })()
      : claimedTask;
    const taskConfig = parseTaskConfig({
      ...options,
      claimTask: undefined,
      reportTaskError: undefined,
      config: { task: taskInput },
    });
    if (!taskConfig) return null;
    await ensureBaiduNetdiskResourceReady(
      taskConfig,
      isClaimedTask ? claimedTask.originalTitle : taskConfig.title,
      isClaimedTask ? claimedTask.accountTaskId : undefined,
      options,
    );
    return {
      taskConfig,
      resourceName: isClaimedTask ? claimedTask.originalTitle : taskConfig.title,
    };
  };

  void runPublishTask(context, page, options, resolveTask).catch(async (error) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(options, `[kuaishou-drama] task failed: ${errorMessage}`);
    if (claimedTaskForReporting && options.reportTaskError) {
      await options.reportTaskError({
        ...claimedTaskForReporting,
        errorMessage,
      }).then(() => {
        log(
          options,
          `[kuaishou-drama] task error reported: ${claimedTaskForReporting?.accountTaskId}`,
        );
      }).catch((reportError) => {
        log(
          options,
          `[kuaishou-drama] task error report failed: ${
            reportError instanceof Error ? reportError.message : String(reportError)
          }`,
        );
      });
    }
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
