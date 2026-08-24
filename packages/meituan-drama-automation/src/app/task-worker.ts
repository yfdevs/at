import type { BrowserContext, Page } from "playwright";
import {
  claimMeituanAccountTaskApi,
  fetchReadyMeituanAccountTasksApi,
  normalizeClaimedMeituanDramaTask,
  reportMeituanAccountTaskApi,
  type MeituanTaskReport,
} from "../api/task.js";
import { runPublishTask } from "../automation/publish-runner.js";
import { log, saveTaskFailureDiagnostics } from "../automation/browser-session.js";
import type {
  MeituanCreationAccount,
  MeituanCreationRuntimeOptions,
  MeituanCreationTaskFailStage,
} from "../shared/types.js";

const emptyTaskDelayMs = 5_000;
const slowEmptyTaskThreshold = 10;
const slowEmptyTaskDelayMs = 30_000;
const taskApiErrorDelayMs = 10_000;
const reportRetryDelayMs = 5_000;
const reportMaxAttempts = 3;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function reportableErrorMessage(error: unknown) {
  const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
  const sanitizedMessage = errorMessage(error)
    .replace(ansiEscapePattern, "")
    .replace(/\r\n/g, "\n")
    .trim();
  const locatorDescription = sanitizedMessage
    .match(/\n\s*-\s*waiting for (.+?)(?:\n|$)/i)?.[1]
    ?.trim()
    .slice(0, 300);
  const message = sanitizedMessage.replace(/\nCall log:[\s\S]*$/i, "").trim();

  if (/Target page, context or browser has been closed/i.test(message)) {
    return "美团页面或浏览器已关闭，无法继续执行页面操作";
  }

  const locatorTimeout = message.match(
    /^locator\.(click|waitFor|fill|check|setInputFiles): Timeout (\d+)ms exceeded\.?$/i,
  );
  if (locatorTimeout) {
    const actionLabels: Record<string, string> = {
      click: "点击页面元素",
      waitfor: "等待页面元素显示",
      fill: "填写页面内容",
      check: "勾选页面选项",
      setinputfiles: "选择上传文件",
    };
    const action = actionLabels[locatorTimeout[1].toLowerCase()] ?? "执行页面操作";
    return `${action}超时（等待 ${locatorTimeout[2]} 毫秒${
      locatorDescription ? `，定位：${locatorDescription}` : ""
    }）`;
  }

  return message || "美团任务执行失败，未获取到具体错误信息";
}

function classifyFailStage(error: unknown): MeituanCreationTaskFailStage {
  const message = errorMessage(error);
  if (/LOGIN|登录/i.test(message)) return "LOGIN";
  if (/CLAIM|领取|MEITUAN_CLAIMED_TASK_INVALID/i.test(message)) return "OTHER";
  if (
    /local-video-invalid|poster-material-invalid|本地剧集|剧集视频|百度网盘|封面|海报|UPLOAD|FILE/i.test(
      message,
    )
  ) {
    return "UPLOAD_FILE";
  }
  if (/SUBMIT|发布按钮|发布失败/i.test(message)) return "SUBMIT";
  if (/RECOGNIZE_RESULT|识别结果|审核结果/i.test(message)) return "RECOGNIZE_RESULT";
  if (/goto|OPEN_FORM|publish page/i.test(message)) return "FILL_FORM";
  return "FILL_FORM";
}

async function waitWhileRunning(delayMs: number, isRunning: () => boolean) {
  const deadline = Date.now() + delayMs;
  while (isRunning() && Date.now() < deadline) {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(1_000, Math.max(1, deadline - Date.now()))),
    );
  }
}

async function reportWithRetry(
  options: MeituanCreationRuntimeOptions,
  report: MeituanTaskReport,
  isRunning: () => boolean,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= reportMaxAttempts; attempt += 1) {
    try {
      await reportMeituanAccountTaskApi({
        apiBaseUrl: options.apiBaseUrl!,
        report,
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= reportMaxAttempts) break;
      log(
        options,
        `[meituan-drama] task report failed, retrying: taskId=${report.taskId} ` +
          `attempt=${attempt}/${reportMaxAttempts} error=${errorMessage(error)}`,
      );
      await waitWhileRunning(reportRetryDelayMs, isRunning);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function runMeituanAccountTaskWorker(options: {
  account: MeituanCreationAccount;
  context: BrowserContext;
  page: Page;
  runtimeOptions: MeituanCreationRuntimeOptions;
  isRunning: () => boolean;
}) {
  const { account, context, page, runtimeOptions, isRunning } = options;
  if (!runtimeOptions.apiBaseUrl?.trim()) {
    throw new Error("MEITUAN_API_BASE_URL_REQUIRED");
  }

  await runPublishTask(context, page, runtimeOptions, null);
  let consecutiveEmptyQueries = 0;

  while (isRunning() && !page.isClosed()) {
    let readyTasks;
    try {
      readyTasks = await fetchReadyMeituanAccountTasksApi({
        apiBaseUrl: runtimeOptions.apiBaseUrl,
        account,
      });
    } catch (error) {
      log(
        runtimeOptions,
        `[meituan-drama] ready task query failed, retrying in 10s: ${errorMessage(error)}`,
      );
      await waitWhileRunning(taskApiErrorDelayMs, isRunning);
      continue;
    }

    if (readyTasks.length === 0) {
      consecutiveEmptyQueries += 1;
      const retryDelayMs =
        consecutiveEmptyQueries >= slowEmptyTaskThreshold ? slowEmptyTaskDelayMs : emptyTaskDelayMs;
      log(
        runtimeOptions,
        `[meituan-drama] no READY task: emptyCount=${consecutiveEmptyQueries} ` +
          `retryDelayMs=${retryDelayMs}`,
      );
      await waitWhileRunning(retryDelayMs, isRunning);
      continue;
    }

    log(
      runtimeOptions,
      `[meituan-drama] fetched ${readyTasks.length} READY task(s), claiming sequentially`,
    );
    let claimedCount = 0;

    for (const listedTask of readyTasks) {
      if (!isRunning() || page.isClosed()) break;

      let claimed;
      try {
        claimed = await claimMeituanAccountTaskApi({
          apiBaseUrl: runtimeOptions.apiBaseUrl,
          accountTaskId: listedTask.id,
        });
      } catch (error) {
        log(
          runtimeOptions,
          `[meituan-drama] task claim failed: accountTaskId=${listedTask.id} ` +
            `error=${errorMessage(error)}`,
        );
        continue;
      }
      if (!claimed) {
        log(
          runtimeOptions,
          `[meituan-drama] task already unavailable after claim: accountTaskId=${listedTask.id}`,
        );
        continue;
      }

      claimedCount += 1;
      let taskNormalized = false;
      let taskPage: Page | null = null;
      try {
        if (claimed.accountTaskId !== listedTask.id) {
          throw new Error(
            `MEITUAN_CLAIMED_TASK_ID_MISMATCH: expected=${listedTask.id} ` +
              `actual=${claimed.accountTaskId}`,
          );
        }
        const task = normalizeClaimedMeituanDramaTask({
          claimed,
          listedTask,
          account,
        });
        taskNormalized = true;
        taskPage = await context.newPage();
        log(
          runtimeOptions,
          `[meituan-drama] opened dedicated task page: accountTaskId=${claimed.accountTaskId}`,
        );
        await runPublishTask(context, taskPage, runtimeOptions, task);

        await reportWithRetry(
          runtimeOptions,
          {
            taskId: claimed.accountTaskId,
            success: true,
            resultJson: {
              activeUrl: taskPage.url(),
              accountId: account.accountId,
              accountName: account.accountName,
            },
          },
          isRunning,
        )
          .then(() => {
            log(
              runtimeOptions,
              `[meituan-drama] task succeeded and reported: accountTaskId=${claimed.accountTaskId}`,
            );
          })
          .catch((reportError) => {
            log(
              runtimeOptions,
              `[meituan-drama] success report exhausted retries: ` +
                `accountTaskId=${claimed.accountTaskId} error=${errorMessage(reportError)}`,
            );
          });
      } catch (error) {
        const message = reportableErrorMessage(error);
        const failStage = taskNormalized ? classifyFailStage(error) : "OTHER";
        const diagnosticDir = await saveTaskFailureDiagnostics({
          page: taskPage,
          runtimeOptions,
          taskId: claimed.accountTaskId,
          error,
        }).catch(() => null);
        log(
          runtimeOptions,
          `[meituan-drama] task failed: accountTaskId=${claimed.accountTaskId} ` +
            `failStage=${failStage} error=${message} ` +
            `diagnostics=${diagnosticDir ?? "(unavailable)"}`,
        );

        await reportWithRetry(
          runtimeOptions,
          {
            taskId: claimed.accountTaskId,
            success: false,
            failStage,
            errorMessage: message,
            resultJson: {
              activeUrl: taskPage?.url() ?? page.url(),
              accountId: account.accountId,
              accountName: account.accountName,
            },
          },
          isRunning,
        ).catch((reportError) => {
          log(
            runtimeOptions,
            `[meituan-drama] failed task report exhausted retries: ` +
              `accountTaskId=${claimed.accountTaskId} error=${errorMessage(reportError)}`,
          );
        });
        continue;
      } finally {
        if (taskPage) {
          if (runtimeOptions.closeTaskPageAfterRun !== false) {
            await taskPage.close().catch(() => undefined);
            log(
              runtimeOptions,
              `[meituan-drama] closed dedicated task page: accountTaskId=${claimed.accountTaskId}`,
            );
          } else {
            log(
              runtimeOptions,
              `[meituan-drama] kept dedicated task page: accountTaskId=${claimed.accountTaskId}`,
            );
          }
        }
      }
    }

    if (claimedCount > 0) {
      consecutiveEmptyQueries = 0;
      continue;
    }

    consecutiveEmptyQueries += 1;
    const retryDelayMs =
      consecutiveEmptyQueries >= slowEmptyTaskThreshold ? slowEmptyTaskDelayMs : emptyTaskDelayMs;
    log(
      runtimeOptions,
      `[meituan-drama] READY rows were not claimable: emptyCount=${consecutiveEmptyQueries} ` +
        `retryDelayMs=${retryDelayMs}`,
    );
    await waitWhileRunning(retryDelayMs, isRunning);
  }
}
