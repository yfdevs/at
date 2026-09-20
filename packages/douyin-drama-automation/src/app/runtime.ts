import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  captureAutomationFailureDiagnostics,
  formatAutomationErrorReport,
} from "@drama/automation-logging";
import { isNonRetryableBaiduNetdiskResourceError } from "@drama/drama-media-assets";
import type { Page } from "playwright";
import {
  claimNextDouyinDramaTaskApi,
  reportDouyinDramaTaskErrorApi,
  reportDouyinDramaTaskSuccessApi,
  resetMockDouyinDramaTaskApi,
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
import {
  collectDouyinNetdiskMetadataInputs,
  douyinTaskNeedsNetdiskMetadata,
  enrichDouyinTaskFromNetdisk,
} from "../shared/netdisk-metadata.js";
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
  if (/FILE|UPLOAD|VIDEO|COVER|POSTER|MATERIAL|文件|上传|视频|封面|海报|素材|合同|承诺/i.test(message)) {
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
  const ensureWithRetry = async (request: Parameters<NonNullable<
    DouyinDramaRuntimeOptions["ensureBaiduNetdiskResource"]
  >>[0]) => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await options.ensureBaiduNetdiskResource!(request);
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
  };

  await ensureWithRetry({
    shareText,
    resourceName: douyinDramaResourceName(task),
    localEpisodeVideoRoot: douyinDramaLocalRoot(options),
    episodeCount: task.playlet.episodeCount,
    requiredOwnership: { minimumImages: 4 },
    requiredPosterImages: 1,
    posterFallback: {
      title: task.playlet.title,
      summary: task.playlet.summary || task.playlet.title,
    },
    requiredAiProductionProofFiles: 0,
    requiredMetadataTextFiles: task.playlet.summary.trim().length <= 100 ? 1 : 0,
    mergeOwnershipMaterials: false,
  });

  if (!douyinTaskNeedsNetdiskMetadata(task)) return;
  const resourceDir = path.join(douyinDramaLocalRoot(options), douyinDramaResourceName(task));
  const inputs = await collectDouyinNetdiskMetadataInputs(resourceDir);
  const missingRequiredText = task.playlet.summary.trim().length <= 100 && inputs.texts.length === 0;
  const missingOriginalRoleImages = (
    task.playlet.roles.length < 2 || task.playlet.roles.some((role) => !role.photoFile)
  )
    && !inputs.images.some((image) => image.relativePath.split(path.sep).includes("原始图片"));
  if (!missingRequiredText && !missingOriginalRoleImages) return;

  log(options, "[douyin-drama] 本地旧素材缺少 TXT 或原始角色图片名，补拉网盘素材目录。", {
    accountTaskId: task.accountTaskId,
    missingRequiredText,
    missingOriginalRoleImages,
  }, "download");
  await ensureWithRetry({
    shareText,
    resourceName: douyinDramaResourceName(task),
    localEpisodeVideoRoot: douyinDramaLocalRoot(options),
    episodeCount: task.playlet.episodeCount,
    downloadEpisodeVideos: false,
    downloadAssetMaterials: true,
    forceAssetDownload: true,
    requiredOwnership: { minimumImages: 0 },
    requiredPosterImages: 1,
    posterFallback: {
      title: task.playlet.title,
      summary: task.playlet.summary || task.playlet.title,
    },
    requiredAiProductionProofFiles: 0,
    requiredMetadataTextFiles: missingRequiredText ? 1 : 0,
    mergeOwnershipMaterials: false,
  });
}

async function runTask(
  taskPage: Page,
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
  try {
    await ensureNetdiskResource(task, options);
    const enrichedTask = await enrichDouyinTaskFromNetdisk(task, options);
    const resources = await prepareDouyinDramaResources(enrichedTask, options);
    log(
      options,
      "[douyin-drama] 任务资源准备完成。",
      { accountTaskId: task.accountTaskId, ...resources },
      "task",
    );
    await runDouyinDramaPublishTask(taskPage, enrichedTask, options);
    await reportDouyinDramaTaskSuccessApi({
      apiConfig: options.apiConfig,
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
    return true;
  } catch (error) {
    const message = formatAutomationErrorReport(error, {
      fallbackMessage: "抖音任务提交失败，未获取到具体错误原因",
    });
    const stage = failStage(error);
    const diagnostics = await captureAutomationFailureDiagnostics({
      platform: "douyin-drama",
      error,
      page: taskPage,
      logFilePath: options.logFilePath,
      stage,
      task: { accountTaskId: task.accountTaskId, title: task.originalTitle },
    });
    await reportDouyinDramaTaskErrorApi({
      apiConfig: options.apiConfig,
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
      {
        accountTaskId: task.accountTaskId,
        title: task.originalTitle,
        failStage: stage,
        diagnosticDir: diagnostics?.directory,
        error,
      },
      "task",
    );
    return false;
  }
}

export async function startDouyinDramaRuntime(
  options: DouyinDramaRuntimeOptions = {},
): Promise<DouyinDramaRuntime> {
  resetMockDouyinDramaTaskApi(options.douyinAccountId);
  const userDataDir =
    options.userDataDir ??
    path.resolve(process.cwd(), ".drama-runs/douyin-drama/auth/chromium-profile");
  await cleanupOldDouyinDramaLogFiles(options).catch(() => undefined);
  log(
    options,
    `[douyin-drama] 运行时启动：userDataDir=${userDataDir}，logFile=${options.logFilePath ?? "未配置"}`,
    { userDataDir, logFilePath: options.logFilePath },
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
        const task = await claimNextDouyinDramaTaskApi({
          apiConfig: options.apiConfig,
          runtimeOptions: options,
        });
        if (task) {
          const taskPage = await page.context().newPage();
          const succeeded = await runTask(taskPage, task, options, (value) => {
            lastTask = value;
          });
          if (!taskPage.isClosed() && (succeeded || options.closeFailedTaskPages === true)) {
            await taskPage.close().catch(() => undefined);
          } else if (!taskPage.isClosed()) {
            log(options, "[douyin-drama] 已保留失败任务页面供排查。", {
              accountTaskId: task.accountTaskId,
              activeUrl: taskPage.url(),
            }, "task");
          }
          continue;
        }
      } catch (error) {
        warn(options, `[douyin-drama] 任务轮询失败：${errorMessage(error)}`, { error }, "polling");
      }
      if (!running) break;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(1_000, options.taskPollIntervalMs ?? 10_000)),
      );
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
