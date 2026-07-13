import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PinduoduoDramaRuntimeOptions } from "./types.js";

export type PinduoduoDramaLogLevel = "info" | "warn" | "error";
export type PinduoduoDramaLogFields = Record<string, unknown>;

function formatChineseDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function normalizeFields(fields: PinduoduoDramaLogFields = {}): Record<string, unknown> {
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

async function writeLogFile(
  options: PinduoduoDramaRuntimeOptions | undefined,
  level: PinduoduoDramaLogLevel,
  scope: string,
  message: string,
  fields?: PinduoduoDramaLogFields,
): Promise<void> {
  if (!options?.logFilePath) {
    return;
  }

  const record = {
    time: formatChineseDateTime(new Date()),
    level,
    platform: "pinduoduo-drama",
    scope,
    accountProfileName: options.accountProfileName,
    ...normalizeFields(fields),
    message,
  };

  await mkdir(dirname(options.logFilePath), { recursive: true });
  await appendFile(options.logFilePath, `${JSON.stringify(record)}\n`, "utf8");
}

export function log(
  options: PinduoduoDramaRuntimeOptions | undefined,
  level: PinduoduoDramaLogLevel,
  scope: string,
  message: string,
  fields?: PinduoduoDramaLogFields,
): void {
  const record = {
    time: formatChineseDateTime(new Date()),
    level,
    platform: "pinduoduo-drama",
    scope,
    ...normalizeFields(fields),
    message,
  };
  if (options?.onLog) {
    options.onLog(JSON.stringify(record));
  } else {
    console[level](JSON.stringify(record));
  }
  void writeLogFile(options, level, scope, message, fields).catch(() => undefined);
}

export function createLogger(scope: string, options?: PinduoduoDramaRuntimeOptions) {
  return {
    info: (message: string, fields?: PinduoduoDramaLogFields) => log(options, "info", scope, message, fields),
    warn: (message: string, fields?: PinduoduoDramaLogFields) => log(options, "warn", scope, message, fields),
    error: (message: string, fields?: PinduoduoDramaLogFields) => log(options, "error", scope, message, fields),
  };
}

export async function cleanupOldLogFiles(options: PinduoduoDramaRuntimeOptions): Promise<void> {
  if (!options.logFilePath) {
    return;
  }

  const configuredRetentionDays = options.logRetentionDays ?? Number(options.config?.logRetentionDays ?? 3);
  const retentionDays = Number.isFinite(configuredRetentionDays) ? Math.max(1, configuredRetentionDays) : 3;
  const logDir = dirname(options.logFilePath);
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  await mkdir(logDir, { recursive: true });

  for (const entry of await readdir(logDir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !/^app-\d{4}-\d{2}-\d{2}\.(?:jsonl|log)$/i.test(entry.name)) {
      continue;
    }

    const filePath = join(logDir, entry.name);
    const stats = await stat(filePath).catch(() => null);
    if (stats && stats.mtimeMs < cutoff) {
      await unlink(filePath).catch(() => undefined);
    }
  }
}
