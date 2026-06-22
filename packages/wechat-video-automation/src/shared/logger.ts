import path from "node:path";
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { format as formatConsoleArgs } from "node:util";
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

export type LogFieldValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogFieldValue>;

const logContextStorage = new AsyncLocalStorage<LogContext>();
const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};
let lastCleanupDate = "";
let consoleFileLoggingInstalled = false;

function readRetentionDays(): number {
  return Math.max(1, integerSetting(getWechatVideoRuntimeSettings().logRetentionDays, 3));
}

function getLogDir(): string {
  return resolveRunDataPath("logs");
}

function getLogBaseName(): string {
  return "app";
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
  const sanitized = value.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
  return sanitized || "unknown";
}

function getLogFilePath(dateKey: string, context: LogContext = {}): string {
  const accountSuffix = context.videoAccountId ? `-${sanitizeFileSegment(context.videoAccountId)}` : "";
  return path.join(getLogDir(), `${getLogBaseName()}${accountSuffix}-${dateKey}.log`);
}

function cleanupOldLogFiles(todayKey: string): void {
  if (lastCleanupDate === todayKey) return;
  lastCleanupDate = todayKey;

  try {
    const logDir = getLogDir();
    const logBaseName = getLogBaseName();
    mkdirSync(logDir, { recursive: true });
    const retentionDays = readRetentionDays();
    const cutoff = dateFromKey(todayKey);
    cutoff.setDate(cutoff.getDate() - retentionDays + 1);
    const escapedBaseName = logBaseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const filePattern = new RegExp(`^${escapedBaseName}(?:-.+)?-(\\d{4}-\\d{2}-\\d{2})\\.log$`);

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

function writeLogFile(line: string, context: LogContext = getLogContext()): void {
  try {
    const todayKey = formatDateKey(new Date());
    cleanupOldLogFiles(todayKey);
    const logFilePath = getLogFilePath(todayKey, context);
    mkdirSync(path.dirname(logFilePath), { recursive: true });
    appendFileSync(logFilePath, `${line}\n`, "utf8");
  } catch {
    // Keep logging best-effort; filesystem failures must not break task execution.
  }
}

function getLogContext(): LogContext {
  return logContextStorage.getStore() ?? {};
}

function quoteLogValue(value: LogFieldValue): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const normalized = value.replace(/\s+/g, " ").trim();
  if (/^[A-Za-z0-9_.:/@-]+$/.test(normalized)) return normalized;
  return JSON.stringify(normalized);
}

function appendFields(parts: string[], fields: LogFields): void {
  for (const [key, value] of Object.entries(fields)) {
    const formattedValue = quoteLogValue(value);
    if (formattedValue !== undefined) parts.push(`${key}=${formattedValue}`);
  }
}

function contextToFields(context: LogContext): LogFields {
  return {
    videoAccountId: context.videoAccountId,
    videoAccountName: context.videoAccountName,
    accountTaskId: context.accountTaskId,
  };
}

function formatLine(
  scope: string,
  level: "info" | "warn" | "error",
  message: string,
  fields: LogFields = {},
  context: LogContext = getLogContext(),
): string {
  const parts = [
    `ts=${new Date().toISOString()}`,
    `level=${level.toUpperCase()}`,
    `scope=${scope}`,
  ];
  appendFields(parts, contextToFields(context));
  appendFields(parts, fields);
  parts.push(`message=${quoteLogValue(message) ?? "\"\""}`);
  return parts.join(" ");
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
    const line = formatLine("console", "info", formatConsoleArgs(...args));
    originalConsole.log(line);
    writeLogFile(line);
  };
  console.warn = (...args: unknown[]) => {
    const line = formatLine("console", "warn", formatConsoleArgs(...args));
    originalConsole.warn(line);
    writeLogFile(line);
  };
  console.error = (...args: unknown[]) => {
    const line = formatLine("console", "error", formatConsoleArgs(...args));
    originalConsole.error(line);
    writeLogFile(line);
  };
}

export function createLogger(scope: string): Logger {
  return {
    info: (message, fields) => {
      const line = formatLine(scope, "info", message, fields);
      originalConsole.log(line);
      writeLogFile(line);
    },
    warn: (message, fields) => {
      const line = formatLine(scope, "warn", message, fields);
      originalConsole.warn(line);
      writeLogFile(line);
    },
    error: (message, fields) => {
      const line = formatLine(scope, "error", message, fields);
      originalConsole.error(line);
      writeLogFile(line);
    },
  };
}

installConsoleFileLogging();
