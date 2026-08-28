import { app, shell } from "electron";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createAutomationLogger,
  formatDateKey,
  type AutomationLogFields,
  type AutomationLogLevel,
} from "@drama/automation-logging";

type MainLogLevel = Exclude<AutomationLogLevel, "debug"> | "debug";

let processLoggingRegistered = false;

export function getMainLogDir() {
  return path.join(getUserDataPath(), "logs");
}

export function getMainLogFilePath() {
  const logDir = getMainLogDir();
  mkdirSync(logDir, { recursive: true });
  return path.join(logDir, `app-${formatDateKey()}.log`);
}

export async function openMainLogDir() {
  const logDir = getMainLogDir();
  mkdirSync(logDir, { recursive: true });
  const errorMessage = await shell.openPath(logDir);
  if (errorMessage) throw new Error(errorMessage);
  return logDir;
}

export function logMain(level: MainLogLevel, message: string, detail?: unknown) {
  try {
    const logger = createAutomationLogger({
      platform: "app",
      scope: "system",
      logFilePath: getMainLogFilePath(),
      retentionDays: 7,
    });
    logger[level](message, detailFields(detail));
  } catch {
    // Logging must never break application startup.
  }
}

export function registerMainProcessLogging() {
  if (processLoggingRegistered) return;
  processLoggingRegistered = true;

  process.on("uncaughtException", (error) => {
    logMain("error", "主进程发生未捕获异常", { error });
  });

  process.on("unhandledRejection", (reason) => {
    logMain("error", "主进程发生未处理的异步异常", { error: reason });
  });

  app.on("web-contents-created", (_event, webContents) => {
    webContents.on("did-fail-load", (_loadEvent, errorCode, errorDescription, validatedURL, isMainFrame) => {
      logMain("error", "页面加载失败", {
        errorCode,
        errorDescription,
        url: validatedURL,
        isMainFrame,
      });
    });

    webContents.on("preload-error", (_preloadEvent, preloadPath, error) => {
      logMain("error", "页面预加载失败", { path: preloadPath, error });
    });

    webContents.on("render-process-gone", (_goneEvent, details) => {
      logMain("error", "页面进程已退出", details);
    });

    webContents.on("console-message", (_consoleEvent, level, message, line, sourceId) => {
      if (level < 2) return;
      logMain(level >= 3 ? "error" : "warn", "页面控制台报告异常", {
        level,
        message,
        line,
        sourceId,
      });
    });
  });

  app.on("child-process-gone", (_event, details) => {
    logMain("error", "子进程已退出", details);
  });

  app.on("will-quit", () => {
    logMain("info", "应用即将退出");
  });
}

function detailFields(detail: unknown): AutomationLogFields | undefined {
  if (detail === undefined) return undefined;
  if (detail instanceof Error) return { error: detail };
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    return detail as AutomationLogFields;
  }
  return { detail };
}

function getUserDataPath() {
  try {
    return app.getPath("userData");
  } catch {
    const appDataPath = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appDataPath, "AutoDrama");
  }
}
