import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { format as formatConsoleArgs } from "node:util";
import pino, { type Logger as PinoLogger } from "pino";
import type { QqDramaRuntimeOptions } from "./types.js";

export type LogFieldValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Error
  | Record<string, unknown>
  | unknown[];
export type LogFields = Record<string, LogFieldValue>;
export type LogContext = {
  accountProfileName?: string;
  qqAccountId?: string;
  qqAccountName?: string;
  accountTaskId?: number;
};

export type Logger = {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
};

const logContextStorage = new AsyncLocalStorage<LogContext>();
const fileLoggers = new Map<string, PinoLogger>();
const invalidLogFileSegmentChars = new Set(["<", ">", ":", "\"", "/", "\\", "|", "?", "*"]);

const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

let consoleFileLoggingInstalled = false;
let defaultOptions: QqDramaRuntimeOptions = {};
let lastCleanupDate = "";

export function configureQqDramaLogger(options: QqDramaRuntimeOptions) {
  defaultOptions = options;
}

function activeOptions(options?: QqDramaRuntimeOptions) {
  return options ?? defaultOptions;
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatChineseDateTime(date: Date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");
  return `${formatDateKey(date)} ${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function dateFromKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function sanitizeFileSegment(value: string) {
  const sanitized = Array.from(value.trim(), (char) => (
    invalidLogFileSegmentChars.has(char) || char.charCodeAt(0) <= 0x1f ? "_" : char
  )).join("");
  return sanitized || "unknown";
}

function logDirFromOptions(options: QqDramaRuntimeOptions) {
  return path.dirname(options.logFilePath ?? path.resolve(process.cwd(), ".drama-runs/qq-drama/logs/app.jsonl"));
}

function logFilePathFromOptions(options: QqDramaRuntimeOptions, context: LogContext = {}) {
  if (options.logFilePath) {
    const dateKey = formatDateKey(new Date());
    const dir = path.dirname(options.logFilePath);
    const accountSegments = [
      context.qqAccountName ?? options.qqAccountName,
      context.qqAccountId ?? options.qqAccountId,
      context.accountProfileName ?? options.accountProfileName,
    ]
      .map((value) => value?.trim())
      .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
      .map(sanitizeFileSegment);
    const accountSuffix = accountSegments.length ? `-${accountSegments.join("-")}` : "";
    return path.join(dir, `app${accountSuffix}-${dateKey}.jsonl`);
  }

  return path.resolve(process.cwd(), ".drama-runs/qq-drama/logs", `app-${formatDateKey(new Date())}.jsonl`);
}

export function cleanupOldLogFiles(options: QqDramaRuntimeOptions = defaultOptions) {
  const todayKey = formatDateKey(new Date());
  if (lastCleanupDate === todayKey) return;
  lastCleanupDate = todayKey;

  try {
    const logDir = logDirFromOptions(options);
    mkdirSync(logDir, { recursive: true });
    const retentionDays = Math.max(1, options.logRetentionDays ?? 3);
    const cutoff = dateFromKey(todayKey);
    cutoff.setDate(cutoff.getDate() - retentionDays + 1);
    const filePattern = /^app(?:-.+)?-(\d{4}-\d{2}-\d{2})\.(?:jsonl|log)$/;

    for (const entry of readdirSync(logDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const match = filePattern.exec(entry.name);
      if (!match) continue;
      if (dateFromKey(match[1]) >= cutoff) continue;
      unlinkSync(path.join(logDir, entry.name));
    }
  } catch {
    // Logging cleanup is best-effort.
  }
}

function getLogContext() {
  return logContextStorage.getStore() ?? {};
}

function getPinoLogger(options: QqDramaRuntimeOptions, context: LogContext): PinoLogger {
  cleanupOldLogFiles(options);
  const logFilePath = logFilePathFromOptions(options, context);
  const cachedLogger = fileLoggers.get(logFilePath);
  if (cachedLogger) return cachedLogger;

  mkdirSync(path.dirname(logFilePath), { recursive: true });
  const logger = pino(
    {
      base: null,
      messageKey: "message",
      timestamp: () => `,"time":"${formatChineseDateTime(new Date())}"`,
      formatters: {
        level(label) {
          return { level: label };
        },
      },
    },
    pino.destination({
      dest: logFilePath,
      mkdir: true,
      sync: false,
    }),
  );
  fileLoggers.set(logFilePath, logger);
  return logger;
}

function normalizeFields(fields: LogFields = {}) {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (value instanceof Error) {
      normalized[key === "error" ? "err" : key] = {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
}

function buildRecord(scope: string, fields: LogFields, context: LogContext, options: QqDramaRuntimeOptions) {
  return {
    scope,
    accountProfileName: options.accountProfileName,
    qqAccountId: options.qqAccountId,
    qqAccountName: options.qqAccountName,
    ...context,
    ...normalizeFields(fields),
  };
}

function writeLog(
  scope: string,
  level: "info" | "warn" | "error",
  message: string,
  fields: LogFields = {},
  options = defaultOptions,
  context: LogContext = getLogContext(),
) {
  try {
    const record = buildRecord(scope, fields, context, options);
    getPinoLogger(options, context)[level](record, message);
    if (scope !== "console") {
      options.onLog?.(message);
    }
    originalConsole[level === "warn" ? "warn" : level === "error" ? "error" : "log"](
      JSON.stringify({
        time: formatChineseDateTime(new Date()),
        level,
        ...record,
        message,
      }),
    );
  } catch {
    // Logging must not break automation.
  }
}

export function runWithLogContext<T>(context: LogContext, action: () => T): T {
  return logContextStorage.run({ ...getLogContext(), ...context }, action);
}

export function createLogger(scope: string): Logger {
  return {
    info: (message, fields) => writeLog(scope, "info", message, fields),
    warn: (message, fields) => writeLog(scope, "warn", message, fields),
    error: (message, fields) => writeLog(scope, "error", message, fields),
  };
}

export function log(options: QqDramaRuntimeOptions, message: string, fields?: LogFields) {
  writeLog("runtime", "info", message, fields, activeOptions(options));
}

export function warn(options: QqDramaRuntimeOptions, message: string, fields?: LogFields) {
  writeLog("runtime", "warn", message, fields, activeOptions(options));
}

export function errorLog(options: QqDramaRuntimeOptions, message: string, fields?: LogFields) {
  writeLog("runtime", "error", message, fields, activeOptions(options));
}

function installConsoleFileLogging() {
  if (consoleFileLoggingInstalled) return;
  consoleFileLoggingInstalled = true;

  console.log = (...args: unknown[]) => {
    writeLog("console", "info", formatConsoleArgs(...args));
  };
  console.warn = (...args: unknown[]) => {
    writeLog("console", "warn", formatConsoleArgs(...args));
  };
  console.error = (...args: unknown[]) => {
    writeLog("console", "error", formatConsoleArgs(...args));
  };
}

installConsoleFileLogging();
