import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DouyinDramaRuntimeOptions } from "./types.js";

export type DouyinDramaLogLevel = "info" | "warn" | "error";
export type DouyinDramaLogFields = Record<string, unknown>;

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

function normalizeFields(fields: DouyinDramaLogFields = {}) {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    normalized[key] = value instanceof Error
      ? { name: value.name, message: value.message, stack: value.stack }
      : value;
  }
  return normalized;
}

function enqueueFileRecord(options: DouyinDramaRuntimeOptions, record: Record<string, unknown>) {
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

export function writeDouyinDramaLog(
  options: DouyinDramaRuntimeOptions,
  level: DouyinDramaLogLevel,
  scope: string,
  message: string,
  fields?: DouyinDramaLogFields,
) {
  const record = {
    time: formatChineseDateTime(new Date()),
    level,
    platform: "douyin-drama",
    scope,
    accountProfileName: options.accountProfileName,
    ...normalizeFields(fields),
    message,
  };
  options.onLog?.(message);
  enqueueFileRecord(options, record);
}

export function log(
  options: DouyinDramaRuntimeOptions,
  message: string,
  fields?: DouyinDramaLogFields,
  scope = "runtime",
) {
  writeDouyinDramaLog(options, "info", scope, message, fields);
}

export function warn(
  options: DouyinDramaRuntimeOptions,
  message: string,
  fields?: DouyinDramaLogFields,
  scope = "runtime",
) {
  writeDouyinDramaLog(options, "warn", scope, message, fields);
}

export function errorLog(
  options: DouyinDramaRuntimeOptions,
  message: string,
  fields?: DouyinDramaLogFields,
  scope = "runtime",
) {
  writeDouyinDramaLog(options, "error", scope, message, fields);
}

export async function flushDouyinDramaLogs(options: DouyinDramaRuntimeOptions) {
  if (!options.logFilePath) return;
  await fileWriteQueues.get(options.logFilePath)?.catch(() => undefined);
}

export async function cleanupOldDouyinDramaLogFiles(options: DouyinDramaRuntimeOptions) {
  if (!options.logFilePath) return;
  const retentionDays = Math.max(1, options.logRetentionDays ?? 3);
  const logDir = dirname(options.logFilePath);
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  await mkdir(logDir, { recursive: true });
  for (const entry of await readdir(logDir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !/^app-\d{4}-\d{2}-\d{2}\.(?:jsonl|log)$/i.test(entry.name)) continue;
    const filePath = join(logDir, entry.name);
    const fileStat = await stat(filePath).catch(() => undefined);
    if (fileStat && fileStat.mtimeMs < cutoff) await unlink(filePath).catch(() => undefined);
  }
}
