import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BaiduDramaRuntimeOptions } from "./types.js";

export type BaiduDramaLogLevel = "info" | "warn" | "error";
export type BaiduDramaLogFields = Record<string, unknown>;

const fileWriteQueues = new Map<string, Promise<void>>();

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

function normalizeFields(fields: BaiduDramaLogFields = {}) {
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

function buildRecord(
  options: BaiduDramaRuntimeOptions,
  level: BaiduDramaLogLevel,
  scope: string,
  message: string,
  fields?: BaiduDramaLogFields,
) {
  return {
    time: formatChineseDateTime(new Date()),
    level,
    platform: "baidu-drama",
    scope,
    accountProfileName: options.accountProfileName,
    ...normalizeFields(fields),
    message,
  };
}

function enqueueFileRecord(options: BaiduDramaRuntimeOptions, record: Record<string, unknown>) {
  const logFilePath = options.logFilePath;
  if (!logFilePath) return;

  const previous = fileWriteQueues.get(logFilePath) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(logFilePath), { recursive: true });
      await appendFile(logFilePath, `${JSON.stringify(record)}\n`, "utf8");
    })
    .catch(() => undefined);
  fileWriteQueues.set(logFilePath, next);
  void next.finally(() => {
    if (fileWriteQueues.get(logFilePath) === next) fileWriteQueues.delete(logFilePath);
  });
}

export function writeBaiduDramaLog(
  options: BaiduDramaRuntimeOptions,
  level: BaiduDramaLogLevel,
  scope: string,
  message: string,
  fields?: BaiduDramaLogFields,
) {
  const record = buildRecord(options, level, scope, message, fields);
  options.onLog?.(message);
  enqueueFileRecord(options, record);
}

export function log(
  options: BaiduDramaRuntimeOptions,
  message: string,
  fields?: BaiduDramaLogFields,
  scope = "runtime",
) {
  writeBaiduDramaLog(options, "info", scope, message, fields);
}

export function warn(
  options: BaiduDramaRuntimeOptions,
  message: string,
  fields?: BaiduDramaLogFields,
  scope = "runtime",
) {
  writeBaiduDramaLog(options, "warn", scope, message, fields);
}

export function errorLog(
  options: BaiduDramaRuntimeOptions,
  message: string,
  fields?: BaiduDramaLogFields,
  scope = "runtime",
) {
  writeBaiduDramaLog(options, "error", scope, message, fields);
}

export async function flushBaiduDramaLogs(options: BaiduDramaRuntimeOptions) {
  if (!options.logFilePath) return;
  await fileWriteQueues.get(options.logFilePath)?.catch(() => undefined);
}

export async function cleanupOldBaiduDramaLogFiles(options: BaiduDramaRuntimeOptions) {
  if (!options.logFilePath) return;

  const retentionDays = Math.max(1, options.logRetentionDays ?? 3);
  const logDir = dirname(options.logFilePath);
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  await mkdir(logDir, { recursive: true });

  for (const entry of await readdir(logDir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !/^app-\d{4}-\d{2}-\d{2}\.(?:jsonl|log)$/i.test(entry.name)) {
      continue;
    }
    const filePath = join(logDir, entry.name);
    const stats = await stat(filePath).catch(() => undefined);
    if (stats && stats.mtimeMs < cutoff) await unlink(filePath).catch(() => undefined);
  }
}
