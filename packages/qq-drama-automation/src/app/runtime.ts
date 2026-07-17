import type { BrowserContext, Page } from "playwright";
import { QQ_DRAMA_ADD_URL, QQ_DRAMA_LOGIN_URL, QQ_DRAMA_PLATFORM } from "../shared/constants.js";
import {
  cleanupOldLogFiles,
  configureQqDramaLogger,
  errorLog,
  log,
  runWithLogContext,
} from "../shared/logger.js";
import type {
  ClaimedQqDramaTask,
  QqDramaRuntime,
  QqDramaRuntimeOptions,
  QqDramaRuntimeStatus,
  QqDramaTaskFailStage,
} from "../shared/types.js";
import {
  getQqDramaLocalEpisodeVideoRoot,
  getQqDramaOriginalTitle,
  validateQqDramaLocalEpisodeVideos,
} from "../shared/local-episode-videos.js";
import {
  launchQqDramaBrowserContext,
  qqDramaLoginStateFromUrl,
  saveCredentialState,
  waitForLoginIfNeeded,
} from "../automation/browser-session.js";
import { openQqDramaAddPage, runQqDramaPublishTask } from "../automation/publish-runner.js";
import {
  claimNextQqDramaTaskApi,
  reportQqDramaTaskErrorApi,
  reportQqDramaTaskSuccessApi,
} from "../api/task.js";

type LastTaskStatus = QqDramaRuntimeStatus["lastTask"];

const defaultTaskPollIntervalMs = 10_000;

function pollIntervalMs(options: QqDramaRuntimeOptions) {
  return Math.max(1_000, options.taskPollIntervalMs ?? defaultTaskPollIntervalMs);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function classifyFailStage(error: unknown, fallback: QqDramaTaskFailStage): QqDramaTaskFailStage {
  const message = errorMessage(error);
  if (message.includes("LOGIN")) return "LOGIN";
  if (/\[local-video-invalid\]|local episode videos|剧集视频|本地剧集视频|FILE|UPLOAD/i.test(message)) {
    return "UPLOAD_FILE";
  }
  if (message.includes("FIELD") || message.includes("FORM")) return "FILL_FORM";
  return fallback;
}

async function ensureBaiduNetdiskResourceReady(
  task: ClaimedQqDramaTask,
  options: QqDramaRuntimeOptions,
) {
  const baiduPanResourceLink = task.playlet.baiduPanResourceLink?.trim();
  const episodeCount = task.playlet.episodeCount;
  if (!baiduPanResourceLink || !episodeCount) return;

  if (!options.ensureBaiduNetdiskResource) {
    throw new Error("任务包含百度网盘资源链接，但当前 QQ 运行时未接入百度网盘下载能力。");
  }

  const localEpisodeVideoRoot = getQqDramaLocalEpisodeVideoRoot(options);
  const resourceName = getQqDramaOriginalTitle(task);
  const retryAttempts = Math.max(0, options.baiduNetdiskDownloadRetryAttempts ?? 3);
  const maxAttempts = retryAttempts + 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      log(options, "[qq-drama] ensuring baidu netdisk resource", {
        accountTaskId: task.accountTaskId,
        resourceName,
        episodeCount,
        attempt,
        maxAttempts,
      });
      await options.ensureBaiduNetdiskResource({
        shareText: baiduPanResourceLink,
        resourceName,
        localEpisodeVideoRoot,
        episodeCount,
      });
      return;
    } catch (error) {
      lastError = error;
      const message = errorMessage(error);
      const nonRetryable = [
        "分享文本中没有找到百度网盘链接",
        "百度网盘账号登录已过期",
        "剧集视频目录不存在",
        "存在重复集数",
        "剧集文件应按文件名匹配",
      ].some((pattern) => message.includes(pattern));
      if (nonRetryable || attempt >= maxAttempts) break;
      log(options, "[qq-drama] baidu netdisk resource failed, retrying", {
        accountTaskId: task.accountTaskId,
        attempt,
        nextAttempt: attempt + 1,
        maxAttempts,
        errorMessage: message,
      });
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function runTask(
  page: Page,
  context: BrowserContext,
  task: ClaimedQqDramaTask,
  options: QqDramaRuntimeOptions,
  setLastTask: (status: LastTaskStatus) => void,
) {
  setLastTask({
    accountTaskId: task.accountTaskId,
    originalTitle: task.originalTitle,
    status: "running",
    updatedAt: new Date().toISOString(),
  });

  try {
    await runWithLogContext(
      {
        accountTaskId: task.accountTaskId,
        qqAccountId: task.qqAccountId,
        qqAccountName: task.qqAccountName,
      },
      async () => {
        await ensureBaiduNetdiskResourceReady(task, options);
        await validateQqDramaLocalEpisodeVideos(task, options);
        await runQqDramaPublishTask(page, context, task, options);
      },
    );
    await reportQqDramaTaskSuccessApi({
      apiConfig: options.apiConfig,
      runtimeOptions: options,
      accountTaskId: task.accountTaskId,
      resultJson: {
        activeUrl: page.url(),
      },
    });
    setLastTask({
      accountTaskId: task.accountTaskId,
      originalTitle: task.originalTitle,
      status: "succeeded",
      updatedAt: new Date().toISOString(),
    });
    log(options, `[qq-drama] task succeeded: accountTaskId=${task.accountTaskId}`);
  } catch (error) {
    const message = errorMessage(error);
    const failStage = classifyFailStage(error, "FILL_FORM");
    setLastTask({
      accountTaskId: task.accountTaskId,
      originalTitle: task.originalTitle,
      status: "failed",
      errorMessage: message,
      updatedAt: new Date().toISOString(),
    });
    await reportQqDramaTaskErrorApi({
      apiConfig: options.apiConfig,
      runtimeOptions: options,
      accountTaskId: task.accountTaskId,
      dramaId: task.dramaId,
      failStage,
      errorMessage: message,
      resultJson: {
        activeUrl: page.url(),
      },
    }).catch((callbackError) => {
      errorLog(options, `[qq-drama] fail callback failed: ${errorMessage(callbackError)}`);
    });
    throw error;
  }
}

export async function startQqDramaRuntime(
  options: QqDramaRuntimeOptions = {},
): Promise<QqDramaRuntime> {
  if (!options.userDataDir) {
    throw new Error("QQ drama userDataDir is required.");
  }

  const userDataDir = options.userDataDir;

  // Runtime 生命周期状态：Electron 通过返回的 getStatus/stop 控制这一个浏览器实例。
  let running = true;
  let page: Page | null = null;
  let context: BrowserContext | null = null;

  // 任务轮询相关状态；测试阶段可以通过 taskPollingEnabled=false 只打开页面不领取任务。
  let taskLoopPromise: Promise<void> | null = null;
  let taskLoopTimer: ReturnType<typeof setTimeout> | null = null;
  let wakeTaskLoop: (() => void) | null = null;
  let lastTask: LastTaskStatus;

  function setLastTask(status: LastTaskStatus) {
    lastTask = status;
  }

  async function waitForNextPoll() {
    // 等待下一轮领取任务；stop 时会调用 wakeTaskLoop 立即唤醒并退出。
    await new Promise<void>((resolve) => {
      wakeTaskLoop = resolve;
      taskLoopTimer = setTimeout(resolve, pollIntervalMs(options));
    });
    if (taskLoopTimer) {
      clearTimeout(taskLoopTimer);
      taskLoopTimer = null;
    }
    wakeTaskLoop = null;
  }

  function stopTaskLoopWait() {
    // 停止服务时清掉定时器，防止后台轮询继续挂着。
    if (taskLoopTimer) {
      clearTimeout(taskLoopTimer);
      taskLoopTimer = null;
    }
    wakeTaskLoop?.();
    wakeTaskLoop = null;
  }

  async function runTaskLoop(activePage: Page, activeContext: BrowserContext) {
    // 正式运行模式：确认登录 -> 领取任务 -> 准备百度网盘资源 -> 上剧 -> 回调结果。
    while (running && !activePage.isClosed()) {
      try {
        await waitForLoginIfNeeded(activePage, activeContext, options);
        const task = await claimNextQqDramaTaskApi({
          apiConfig: options.apiConfig,
          runtimeOptions: options,
        });

        if (task) {
          await runTask(activePage, activeContext, task, options, setLastTask);
        } else {
          log(options, "[qq-drama] no claimable task");
        }
      } catch (error) {
        errorLog(options, `[qq-drama] task loop tick failed: ${errorMessage(error)}`);
      }

      if (!running || activePage.isClosed()) break;
      await waitForNextPoll();
    }
  }

  configureQqDramaLogger(options);
  cleanupOldLogFiles(options);

  // QQ 有反爬要求，这里启动的是本机正式版 Chrome，并复用 userDataDir 保存登录态。
  log(options, `[qq-drama] starting browser: userDataDir=${userDataDir}`);
  context = await launchQqDramaBrowserContext(userDataDir, options);
  context.on("close", () => {
    running = false;
    stopTaskLoopWait();
  });

  page = context.pages()[0] ?? (await context.newPage());
  // 服务启动后先打开上剧页；如果登录态失效，openQqDramaAddPage 会跳到登录并等待人工登录。
  await openQqDramaAddPage(page, context, options).catch((error) => {
    errorLog(options, `[qq-drama] failed to open add page: ${errorMessage(error)}`);
  });

  taskLoopPromise = runTaskLoop(page, context);

  return {
    getStatus(): QqDramaRuntimeStatus {
      const activeUrl = page?.url();
      return {
        platform: QQ_DRAMA_PLATFORM,
        running,
        loginState: qqDramaLoginStateFromUrl(activeUrl),
        activeUrl,
        addUrl: QQ_DRAMA_ADD_URL,
        loginUrl: QQ_DRAMA_LOGIN_URL,
        userDataDir,
        accountProfileName: options.accountProfileName,
        accountDir: options.accountDir,
        credentialStatePath: options.credentialStatePath,
        assetDownloadDir: options.assetDownloadDir,
        logFilePath: options.logFilePath,
        lastTask,
      };
    },
    async stop() {
      // stop 会保存一次 storage-state，再关闭持久化浏览器上下文。
      running = false;
      stopTaskLoopWait();
      if (context) {
        await saveCredentialState(context, options).catch(() => undefined);
      }
      await context?.close();
      await taskLoopPromise?.catch(() => undefined);
      log(options, "[qq-drama] runtime stopped");
    },
  };
}
