import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import pino, { type Logger as PinoLogger } from "pino";

import type { IqiyiDramaRuntimeOptions } from "./types.js";

type LogValue = string | number | boolean | null | undefined | Error | unknown[] | Record<string, unknown>;
type LogFields = Record<string, LogValue>;
type LogContext = {
  accountTaskId?: number;
  iqiyiAccountId?: string;
  iqiyiAccountName?: string;
};

const contextStorage = new AsyncLocalStorage<LogContext>();
const fileLoggers = new Map<string, PinoLogger>();
let defaultOptions: IqiyiDramaRuntimeOptions = {};
let lastCleanupDate = "";

function dateKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function safeSegment(value: string) {
  return value.replace(/[<>:"/\\|?*\p{Cc}]/gu, "_").trim() || "unknown";
}

function logFile(options: IqiyiDramaRuntimeOptions, context: LogContext) {
  const configured = options.logFilePath
    ?? path.resolve(process.cwd(), ".drama-runs/iqiyi-drama/logs/app.jsonl");
  const suffix = [
    context.iqiyiAccountName ?? options.iqiyiAccountName,
    context.iqiyiAccountId ?? options.iqiyiAccountId,
  ].filter((value, index, values): value is string =>
    Boolean(value?.trim()) && values.indexOf(value) === index
  ).map(safeSegment);
  return path.join(
    path.dirname(configured),
    `app${suffix.length ? `-${suffix.join("-")}` : ""}-${dateKey()}.jsonl`,
  );
}

function logger(options: IqiyiDramaRuntimeOptions, context: LogContext) {
  const target = logFile(options, context);
  const cached = fileLoggers.get(target);
  if (cached) return cached;
  mkdirSync(path.dirname(target), { recursive: true });
  const created = pino(
    { base: null, messageKey: "message" },
    pino.destination({ dest: target, mkdir: true, sync: false }),
  );
  fileLoggers.set(target, created);
  return created;
}

function normalizedFields(fields: LogFields = {}) {
  return Object.fromEntries(Object.entries(fields).flatMap(([key, value]) => {
    if (value === undefined) return [];
    if (value instanceof Error) {
      return [[key === "error" ? "err" : key, {
        name: value.name,
        message: value.message,
        stack: value.stack,
      }]];
    }
    return [[key, value]];
  }));
}

function write(
  level: "info" | "warn" | "error",
  options: IqiyiDramaRuntimeOptions,
  message: string,
  fields?: LogFields,
) {
  try {
    const context = contextStorage.getStore() ?? {};
    const record = {
      platform: "iqiyi-drama",
      iqiyiAccountId: options.iqiyiAccountId,
      iqiyiAccountName: options.iqiyiAccountName,
      ...context,
      ...normalizedFields(fields),
    };
    logger(options, context)[level](record, message);
    options.onLog?.(message);
    const output = JSON.stringify({ level, ...record, message });
    if (level === "error") console.error(output);
    else if (level === "warn") console.warn(output);
    else console.log(output);
  } catch {
    // Logging is best-effort and must not break publishing.
  }
}

export function configureIqiyiDramaLogger(options: IqiyiDramaRuntimeOptions) {
  defaultOptions = options;
}

export function cleanupOldLogFiles(options: IqiyiDramaRuntimeOptions = defaultOptions) {
  const today = dateKey();
  if (lastCleanupDate === today) return;
  lastCleanupDate = today;
  try {
    const logDir = path.dirname(logFile(options, {}));
    mkdirSync(logDir, { recursive: true });
    const cutoff = dateFromKey(today);
    cutoff.setDate(cutoff.getDate() - Math.max(1, options.logRetentionDays ?? 3) + 1);
    for (const entry of readdirSync(logDir, { withFileTypes: true })) {
      const match = entry.isFile() && /^(?:app.*-)?(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(entry.name);
      if (match && dateFromKey(match[1]) < cutoff) unlinkSync(path.join(logDir, entry.name));
    }
  } catch {
    // Cleanup is best-effort.
  }
}

export function runWithLogContext<T>(context: LogContext, action: () => T): T {
  return contextStorage.run({ ...contextStorage.getStore(), ...context }, action);
}

export function log(options: IqiyiDramaRuntimeOptions, message: string, fields?: LogFields) {
  write("info", options, message, fields);
}

export function warn(options: IqiyiDramaRuntimeOptions, message: string, fields?: LogFields) {
  write("warn", options, message, fields);
}

export function errorLog(options: IqiyiDramaRuntimeOptions, message: string, fields?: LogFields) {
  write("error", options, message, fields);
}
