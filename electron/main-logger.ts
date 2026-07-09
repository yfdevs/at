import { app, shell } from "electron";
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import util from "node:util";

type MainLogLevel = "debug" | "info" | "warn" | "error";

const maxLogSizeBytes = 2 * 1024 * 1024;
const logFileName = "main.log";
let processLoggingRegistered = false;

export function getMainLogDir() {
  return path.join(getUserDataPath(), "logs");
}

export function getMainLogFilePath() {
  const logDir = getMainLogDir();
  mkdirSync(logDir, { recursive: true });

  const logFilePath = path.join(logDir, logFileName);
  rotateLogFile(logFilePath);

  return logFilePath;
}

export async function openMainLogDir() {
  const logDir = getMainLogDir();
  mkdirSync(logDir, { recursive: true });

  const errorMessage = await shell.openPath(logDir);

  if (errorMessage) {
    throw new Error(errorMessage);
  }

  return logDir;
}

export function logMain(level: MainLogLevel, message: string, detail?: unknown) {
  try {
    const record: Record<string, unknown> = {
      timestamp: formatChineseDateTime(new Date()),
      level,
      pid: process.pid,
      message,
    };

    if (detail !== undefined) {
      record.detail = serializeLogValue(detail);
    }

    appendFileSync(getMainLogFilePath(), `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    // Logging must never break application startup.
  }
}

function formatChineseDateTime(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
}

export function registerMainProcessLogging() {
  if (processLoggingRegistered) {
    return;
  }

  processLoggingRegistered = true;

  process.on("uncaughtException", (error) => {
    logMain("error", "uncaught exception", error);
  });

  process.on("unhandledRejection", (reason) => {
    logMain("error", "unhandled promise rejection", reason);
  });

  app.on("web-contents-created", (_event, webContents) => {
    webContents.on("did-fail-load", (_loadEvent, errorCode, errorDescription, validatedURL, isMainFrame) => {
      logMain("error", "renderer did fail load", {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
      });
    });

    webContents.on("preload-error", (_preloadEvent, preloadPath, error) => {
      logMain("error", "renderer preload error", { preloadPath, error: serializeLogValue(error) });
    });

    webContents.on("render-process-gone", (_goneEvent, details) => {
      logMain("error", "renderer process gone", details);
    });

    webContents.on("console-message", (_consoleEvent, level, message, line, sourceId) => {
      if (level >= 2) {
        logMain(level >= 3 ? "error" : "warn", "renderer console message", {
          level,
          message,
          line,
          sourceId,
        });
      }
    });
  });

  app.on("child-process-gone", (_event, details) => {
    logMain("error", "child process gone", details);
  });

  app.on("will-quit", (_event) => {
    logMain("info", "app will quit");
  });
}

function getUserDataPath() {
  try {
    return app.getPath("userData");
  } catch {
    const appDataPath = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appDataPath, "AutoDrama");
  }
}

function rotateLogFile(logFilePath: string) {
  if (!existsSync(logFilePath)) {
    return;
  }

  const size = statSync(logFilePath).size;

  if (size <= maxLogSizeBytes) {
    return;
  }

  const previousLogFilePath = path.join(path.dirname(logFilePath), "main.previous.log");
  rmSync(previousLogFilePath, { force: true });
  renameSync(logFilePath, previousLogFilePath);
}

function serializeLogValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (typeof value === "object" && value !== null) {
    return util.inspect(value, {
      breakLength: 180,
      depth: 6,
      maxArrayLength: 50,
    });
  }

  return value;
}
