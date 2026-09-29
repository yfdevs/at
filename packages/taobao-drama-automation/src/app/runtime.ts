import type { BrowserContext, Page } from "playwright";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  captureAutomationFailureDiagnostics,
  formatAutomationErrorReport,
} from "@drama/automation-logging";
import {
  TAOBAO_DRAMA_BATCH_PUBLISH_URL,
  TAOBAO_DRAMA_LOGIN_URL,
  TAOBAO_DRAMA_PLATFORM,
} from "../shared/constants.js";
import { cleanupOldLogFiles, errorLog, log } from "../shared/logger.js";
import type {
  TaobaoBatchUploadTask,
  TaobaoDramaRuntime,
  TaobaoDramaRuntimeOptions,
  TaobaoDramaRuntimeStatus,
  TaobaoDramaTaskFailStage,
} from "../shared/types.js";
import {
  launchTaobaoBrowserContext,
  saveTaobaoCredentialState,
  taobaoLoginStateFromUrl,
  waitForTaobaoPage,
} from "../automation/browser-session.js";
import { runTaobaoPublishTask } from "../automation/publish-runner.js";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function failStage(error: unknown): TaobaoDramaTaskFailStage {
  const message = errorMessage(error);
  if (/LOGIN|登录|校验/i.test(message)) return "LOGIN";
  if (/网盘|下载|DOWNLOAD/i.test(message)) return "DOWNLOAD";
  if (/UPLOAD|FILE|VIDEO|素材|视频/i.test(message)) return "UPLOAD_FILE";
  if (/SUBMIT|PUBLISH|发布/i.test(message)) return "SUBMIT";
  if (/RESULT|RECOGNIZED|识别/i.test(message)) return "RECOGNIZE_RESULT";
  return "OTHER";
}

async function captureTaobaoFailureDom(page: Page, directory: string) {
  const frames = page.frames();
  const manifest: Array<{
    index: number;
    name: string;
    url: string;
    file?: string;
    error?: string;
  }> = [];
  for (const [index, frame] of frames.entries()) {
    const file = `frame-${index}.html`;
    try {
      await writeFile(path.join(directory, file), await frame.content(), "utf8");
      manifest.push({ index, name: frame.name(), url: frame.url(), file });
    } catch (error) {
      manifest.push({
        index,
        name: frame.name(),
        url: frame.url(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  await writeFile(
    path.join(directory, "frames.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

async function runTask(
  page: Page,
  context: BrowserContext,
  task: TaobaoBatchUploadTask,
  options: TaobaoDramaRuntimeOptions,
  setLastTask: (task: TaobaoDramaRuntimeStatus["lastTask"]) => void,
) {
  setLastTask({
    taskId: task.id,
    originalTitle: task.originalTitle,
    status: "running",
    updatedAt: new Date().toISOString(),
  });
  try {
    await runTaobaoPublishTask(page, context, task, options);
    await options.completeTask?.({ taskId: task.id, success: true });
    setLastTask({
      taskId: task.id,
      originalTitle: task.originalTitle,
      status: "succeeded",
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = formatAutomationErrorReport(error, {
      fallbackMessage: "淘宝短剧批量上传失败，未获取到具体错误原因",
    });
    const stage = failStage(error);
    const diagnostics = await captureAutomationFailureDiagnostics({
      platform: "taobao-drama",
      error,
      page,
      logFilePath: options.logFilePath,
      stage,
      task: { title: task.originalTitle },
    });
    if (diagnostics && !page.isClosed()) {
      await captureTaobaoFailureDom(page, diagnostics.directory).catch(() => undefined);
    }
    await options.completeTask?.({ taskId: task.id, success: false, errorMessage: message });
    setLastTask({
      taskId: task.id,
      originalTitle: task.originalTitle,
      status: "failed",
      errorMessage: message,
      updatedAt: new Date().toISOString(),
    });
    errorLog(options, `[taobao-drama] 失败诊断目录：${diagnostics?.directory ?? "不可用"}`);
    throw error;
  }
}

export async function startTaobaoDramaRuntime(
  options: TaobaoDramaRuntimeOptions = {},
): Promise<TaobaoDramaRuntime> {
  if (!options.userDataDir) throw new Error("TAOBAO_DRAMA_USER_DATA_DIR_REQUIRED");
  if (!options.claimNextTask) throw new Error("TAOBAO_DRAMA_LOCAL_TASK_SOURCE_REQUIRED");
  await cleanupOldLogFiles(options);

  let running = true;
  let lastTask: TaobaoDramaRuntimeStatus["lastTask"];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let wake: (() => void) | null = null;
  let emptyQueueLogged = false;
  const context = await launchTaobaoBrowserContext(options.userDataDir, options);
  let taskPage: Page | undefined = context.pages()[0] ?? await context.newPage();
  context.on("close", () => {
    running = false;
    wake?.();
  });

  const waitPoll = () => new Promise<void>((resolve) => {
    wake = resolve;
    timer = setTimeout(resolve, Math.max(1_000, options.taskPollIntervalMs ?? 2_000));
  }).finally(() => {
    if (timer) clearTimeout(timer);
    timer = null;
    wake = null;
  });

  const loop = (async () => {
    await waitForTaobaoPage(taskPage!, "batch", options);
    await saveTaobaoCredentialState(context, options).catch(() => undefined);
    while (running) {
      try {
        const task = await options.claimNextTask!();
        if (!task) {
          if (!emptyQueueLogged) {
            log(options, "[taobao-drama] 本地导入队列暂无待上传任务");
            emptyQueueLogged = true;
          }
        } else {
          emptyQueueLogged = false;
          if (!taskPage || taskPage.isClosed()) {
            taskPage = await context.newPage();
          }
          const currentTaskPage = taskPage;
          let failed = false;
          try {
            await runTask(currentTaskPage, context, task, options, (value) => { lastTask = value; });
          } catch (error) {
            failed = true;
            errorLog(options, `[taobao-drama] 任务失败：${errorMessage(error)}`);
          } finally {
            if (failed && !currentTaskPage.isClosed()) {
              if (options.closeFailedTaskPages === true) {
                await currentTaskPage.close().catch(() => undefined);
              } else {
                log(options, "[taobao-drama] 已保留失败任务页面供排查", {
                  activeUrl: currentTaskPage.url(),
                  title: task.originalTitle,
                });
              }
              taskPage = undefined;
            } else if (currentTaskPage.isClosed()) {
              taskPage = undefined;
            } else {
              log(options, "[taobao-drama] 复用当前任务页面处理后续队列", {
                activeUrl: currentTaskPage.url(),
                title: task.originalTitle,
              });
            }
          }
        }
      } catch (error) {
        errorLog(options, `[taobao-drama] 本地任务队列处理失败：${errorMessage(error)}`);
      }
      if (running) await waitPoll();
    }
  })();
  void loop.catch((error) => {
    running = false;
    errorLog(options, `[taobao-drama] 本地任务循环已停止：${errorMessage(error)}`);
  });

  return {
    getStatus() {
      const openPages = context.pages().filter((item) => !item.isClosed());
      const activePage = taskPage && !taskPage.isClosed()
        ? taskPage
        : openPages[openPages.length - 1];
      return {
        platform: TAOBAO_DRAMA_PLATFORM,
        running,
        loginState: taobaoLoginStateFromUrl(activePage?.url() ?? ""),
        activeUrl: activePage?.url() ?? "",
        batchPublishUrl: TAOBAO_DRAMA_BATCH_PUBLISH_URL,
        loginUrl: TAOBAO_DRAMA_LOGIN_URL,
        userDataDir: options.userDataDir!,
        accountProfileName: options.accountProfileName,
        lastTask,
      };
    },
    async stop() {
      running = false;
      wake?.();
      await saveTaobaoCredentialState(context, options).catch(() => undefined);
      await context.close();
      await loop.catch(() => undefined);
      log(options, "[taobao-drama] 运行时已停止");
    },
  };
}
