import path from "node:path";
import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { format as formatConsoleArgs } from "node:util";
import pino, { type Logger as PinoLogger } from "pino";
import { resolveRunDataPath } from "./config.js";
import { getWechatVideoRuntimeSettings } from "./runtime-settings.js";
import { integerSetting } from "./settings-value.js";

export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export interface LogContext {
  videoAccountId?: string;
  videoAccountName?: string;
  accountTaskId?: number;
}

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

const logContextStorage = new AsyncLocalStorage<LogContext>();
const fileLoggers = new Map<string, PinoLogger>();
const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};
const invalidLogFileSegmentChars = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

let lastCleanupDate = "";
let consoleFileLoggingInstalled = false;

function readRetentionDays(): number {
  return Math.max(1, integerSetting(getWechatVideoRuntimeSettings().logRetentionDays, 3));
}

function getLogDir(): string {
  return resolveRunDataPath("logs");
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function sanitizeFileSegment(value: string): string {
  const sanitized = Array.from(value.trim(), (char) => (
    invalidLogFileSegmentChars.has(char) || char.charCodeAt(0) <= 0x1f ? "_" : char
  )).join("");
  return sanitized || "unknown";
}

function getLogFilePath(dateKey: string, context: LogContext = {}): string {
  const accountSuffix = context.videoAccountId ? `-${sanitizeFileSegment(context.videoAccountId)}` : "";
  return path.join(getLogDir(), `app${accountSuffix}-${dateKey}.jsonl`);
}

function cleanupOldLogFiles(todayKey: string): void {
  if (lastCleanupDate === todayKey) return;
  lastCleanupDate = todayKey;

  try {
    const logDir = getLogDir();
    mkdirSync(logDir, { recursive: true });
    const retentionDays = readRetentionDays();
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

    const legacyLogFile = path.resolve(process.cwd(), ".runs/app.log");
    const legacyStats = statSync(legacyLogFile, { throwIfNoEntry: false });
    if (legacyStats?.isFile() && legacyStats.mtime < cutoff) {
      unlinkSync(legacyLogFile);
    }
  } catch {
    // Keep cleanup best-effort; filesystem failures must not break task execution.
  }
}

function getLogContext(): LogContext {
  return logContextStorage.getStore() ?? {};
}

function getPinoLogger(context: LogContext): PinoLogger {
  const todayKey = formatDateKey(new Date());
  cleanupOldLogFiles(todayKey);
  const logFilePath = getLogFilePath(todayKey, context);
  const cachedLogger = fileLoggers.get(logFilePath);

  if (cachedLogger) {
    return cachedLogger;
  }

  mkdirSync(path.dirname(logFilePath), { recursive: true });
  const logger = pino(
    {
      base: null,
      messageKey: "message",
      timestamp: pino.stdTimeFunctions.isoTime,
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

function normalizeFields(fields: LogFields = {}): Record<string, unknown> {
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

function buildRecord(scope: string, fields: LogFields, context: LogContext): Record<string, unknown> {
  return {
    scope,
    ...context,
    ...normalizeFields(fields),
  };
}

function writeLog(
  scope: string,
  level: "info" | "warn" | "error",
  message: string,
  fields: LogFields = {},
  context: LogContext = getLogContext(),
): void {
  try {
    const record = buildRecord(scope, fields, context);
    getPinoLogger(context)[level](record, message);
    originalConsole[level === "warn" ? "warn" : level === "error" ? "error" : "log"](
      JSON.stringify({
        time: new Date().toISOString(),
        level,
        ...record,
        message,
      }),
    );
  } catch {
    // Keep logging best-effort; filesystem failures must not break task execution.
  }
}

export function runWithLogContext<T>(context: LogContext, action: () => T): T {
  const nextContext: LogContext = { ...getLogContext() };
  for (const [key, value] of Object.entries(context) as Array<[keyof LogContext, LogContext[keyof LogContext]]>) {
    if (value !== undefined) {
      Object.assign(nextContext, { [key]: value });
    }
  }
  return logContextStorage.run(nextContext, action);
}

function installConsoleFileLogging(): void {
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

export function createLogger(scope: string): Logger {
  return {
    info: (message, fields) => writeLog(scope, "info", message, fields),
    warn: (message, fields) => writeLog(scope, "warn", message, fields),
    error: (message, fields) => writeLog(scope, "error", message, fields),
  };
}

installConsoleFileLogging();
