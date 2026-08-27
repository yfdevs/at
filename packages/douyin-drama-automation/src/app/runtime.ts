import { mkdir } from "node:fs/promises";
import path from "node:path";
import { isNonRetryableBaiduNetdiskResourceError } from "@drama/drama-media-assets";
import type { Page } from "playwright";
import {
  claimNextDouyinDramaTaskApi,
  reportDouyinDramaTaskErrorApi,
  reportDouyinDramaTaskSuccessApi,
} from "../api/task.js";
import {
  douyinDramaLoginStateFromUrl,
  ensureDouyinDramaCreatePage,
  launchDouyinDramaBrowserContext,
  openDouyinDramaCreatePage,
  waitForDouyinDramaLogin,
} from "../automation/browser-session.js";
import { runDouyinDramaPublishTask } from "../automation/publish-runner.js";
import { DOUYIN_DRAMA_CREATE_URL, DOUYIN_DRAMA_LOGIN_URL } from "../shared/constants.js";
import {
  cleanupOldDouyinDramaLogFiles,
  errorLog,
  flushDouyinDramaLogs,
  log,
  warn,
} from "../shared/logger.js";
import {
  douyinDramaLocalRoot,
  douyinDramaResourceName,
  prepareDouyinDramaResources,
} from "../shared/resources.js";
import type {
  ClaimedDouyinDramaTask,
  DouyinDramaRuntime,
  DouyinDramaRuntimeOptions,
  DouyinDramaRuntimeStatus,
  DouyinDramaTaskFailStage,
} from "../shared/types.js";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function failStage(error: unknown): DouyinDramaTaskFailStage {
  const message = errorMessage(error);
  if (/LOGIN/i.test(message)) return "LOGIN";
  if (/NETDISK|DOWNLOAD|网盘|下载/i.test(message)) return "DOWNLOAD";
  if (/FILE|UPLOAD|VIDEO|COVER|POSTER|文件|上传|视频|封面|海报/i.test(message)) {
    return "UPLOAD_FILE";
  }
  if (/FORM|FIELD|LOCATOR|STRICT MODE|SELECT|OPTION|表单|字段|填写|选择/i.test(message)) {
    return "FILL_FORM";
  }
  if (/SUBMIT|提交/i.test(message)) return "SUBMIT";
  return "OTHER";
}

async function ensureNetdiskResource(
  task: ClaimedDouyinDramaTask,
  options: DouyinDramaRuntimeOptions,
) {
  const shareText = task.playlet.baiduPanResourceLink?.trim();
  if (!shareText) return;
  if (!options.ensureBaiduNetdiskResource) {
    throw new Error("任务包含百度网盘链接，但抖音运行时未接入网盘下载能力");
  }
  const maxAttempts = Math.max(0, options.baiduNetdiskDownloadRetryAttempts ?? 3) + 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await options.ensureBaiduNetdiskResource({
        shareText,
        resourceName: douyinDramaResourceName(task),
        localEpisodeVideoRoot: douyinDramaLocalRoot(options),
        episodeCount: task.playlet.episodeCount,
        requiredOwnership: { minimumImages: 4 },
        requiredPosterImages: 1,
        requiredAiProductionProofFiles: 0,
        mergeOwnershipMaterials: false,
      });
      return;
    } catch (error) {
      lastError = error;
      if (isNonRetryableBaiduNetdiskResourceError(error) || attempt === maxAttempts) break;
      warn(
        options,
        `[douyin-drama] 百度网盘下载失败，准备重试：${attempt}/${maxAttempts}`,
        { error },
        "download",
      );
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
  throw lastError;
}

async function runTask(
  basePage: Page,
  task: ClaimedDouyinDramaTask,
  options: DouyinDramaRuntimeOptions,
  setLastTask: (lastTask: NonNullable<DouyinDramaRuntimeStatus["lastTask"]>) => void,
) {
  log(
    options,
    `[douyin-drama] 任务开始：taskId=${task.accountTaskId}，剧名=${task.originalTitle}`,
    { accountTaskId: task.accountTaskId, title: task.originalTitle },
    "task",
  );
  setLastTask({
    accountTaskId: task.accountTaskId,
    originalTitle: task.originalTitle,
    status: "running",
    updatedAt: new Date().toISOString(),
  });
  const taskPage = await basePage.context().newPage();
  try {
    await ensureNetdiskResource(task, options);
    const resources = await prepareDouyinDramaResources(task, options);
    log(
      options,
      "[douyin-drama] 任务资源准备完成。",
      { accountTaskId: task.accountTaskId, ...resources },
      "task",
    );
    await runDouyinDramaPublishTask(taskPage, task, options);
    await reportDouyinDramaTaskSuccessApi({
      runtimeOptions: options,
      accountTaskId: task.accountTaskId,
    });
    setLastTask({
      accountTaskId: task.accountTaskId,
      originalTitle: task.originalTitle,
      status: "succeeded",
      updatedAt: new Date().toISOString(),
    });
    log(
      options,
      `[douyin-drama] 任务成功：taskId=${task.accountTaskId}，剧名=${task.originalTitle}`,
      { accountTaskId: task.accountTaskId, title: task.originalTitle },
      "task",
    );
  } catch (error) {
    const message = errorMessage(error);
    const stage = failStage(error);
    await reportDouyinDramaTaskErrorApi({
      runtimeOptions: options,
      accountTaskId: task.accountTaskId,
      failStage: stage,
      errorMessage: message,
    });
    setLastTask({
      accountTaskId: task.accountTaskId,
      originalTitle: task.originalTitle,
      status: "failed",
      errorMessage: message,
      updatedAt: new Date().toISOString(),
    });
    errorLog(
      options,
      `[douyin-drama] 任务失败：taskId=${task.accountTaskId}，阶段=${stage}，错误=${message}`,
      { accountTaskId: task.accountTaskId, title: task.originalTitle, failStage: stage, error },
      "task",
    );
  } finally {
    if (!taskPage.isClosed()) await taskPage.close().catch(() => undefined);
  }
}

export async function startDouyinDramaRuntime(
  options: DouyinDramaRuntimeOptions = {},
): Promise<DouyinDramaRuntime> {
  const userDataDir = options.userDataDir ?? path.resolve(
    process.cwd(),
    ".drama-runs/douyin-drama/auth/chromium-profile",
  );
  await cleanupOldDouyinDramaLogFiles(options).catch(() => undefined);
  log(
    options,
    `[douyin-drama] 运行时启动：userDataDir=${userDataDir}，logFile=${options.logFilePath ?? "未配置"}`,
    { userDataDir, logFilePath: options.logFilePath, mockTaskEnabled: options.mockTaskEnabled },
  );
  await mkdir(userDataDir, { recursive: true });
  const context = await launchDouyinDramaBrowserContext(userDataDir, options);
  const page = context.pages()[0] ?? (await context.newPage());
  let running = true;
  let lastTask: DouyinDramaRuntimeStatus["lastTask"];
  try {
    await openDouyinDramaCreatePage(page);
    await waitForDouyinDramaLogin(page, context, options);
    await ensureDouyinDramaCreatePage(page, options);
  } catch (error) {
    errorLog(options, `[douyin-drama] 运行时启动失败：${errorMessage(error)}`, { error });
    await context.close().catch(() => undefined);
    await flushDouyinDramaLogs(options);
    throw error;
  }

  const pollLoop = async () => {
    while (running) {
      try {
        const task = await claimNextDouyinDramaTaskApi({ runtimeOptions: options });
        if (task) {
          await runTask(page, task, options, (value) => { lastTask = value; });
          continue;
        }
      } catch (error) {
        warn(options, `[douyin-drama] 任务轮询失败：${errorMessage(error)}`, { error }, "polling");
      }
      if (!running) break;
      await new Promise((resolve) => setTimeout(
        resolve,
        Math.max(1_000, options.taskPollIntervalMs ?? 10_000),
      ));
    }
  };
  void pollLoop();

  return {
    getStatus() {
      return {
        platform: "douyin-drama",
        running,
        loginState: douyinDramaLoginStateFromUrl(page.url()),
        activeUrl: page.url(),
        createUrl: DOUYIN_DRAMA_CREATE_URL,
        loginUrl: DOUYIN_DRAMA_LOGIN_URL,
        userDataDir,
        lastTask,
      };
    },
    async stop() {
      running = false;
      log(options, "[douyin-drama] 运行时停止。", undefined, "runtime");
      await context.close().catch(() => undefined);
      await flushDouyinDramaLogs(options);
    },
  };
}
