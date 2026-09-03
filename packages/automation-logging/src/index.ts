import { mkdirSync } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import {
  createLogger as createWinstonLogger,
  format as winstonFormat,
  transports as winstonTransports,
  type transport as WinstonTransport,
} from "winston";

export type AutomationLogLevel = "debug" | "info" | "warn" | "error";
export type AutomationLogFields = Record<string, unknown>;

export type AutomationLogEntry = {
  version: 1;
  pid: number;
  time: string;
  level: AutomationLogLevel;
  platform: string;
  scope: string;
  message: string;
  context?: AutomationLogFields;
  details?: AutomationLogFields;
};

export type AutomationLogInput = string | AutomationLogEntry;

export type AutomationLogMethod = {
  (message: string, fields?: AutomationLogFields): void;
  (fields: AutomationLogFields, message: string): void;
};

export type AutomationLogger = {
  debug: AutomationLogMethod;
  info: AutomationLogMethod;
  warn: AutomationLogMethod;
  error: AutomationLogMethod;
  child(options: { scope?: string; context?: AutomationLogFields }): AutomationLogger;
  callback(scope?: string, context?: AutomationLogFields): (message: string) => void;
  flush(): Promise<void>;
};

export type CreateAutomationLoggerOptions = {
  platform: string;
  scope?: string;
  context?: AutomationLogFields;
  logFilePath?: string;
  retentionDays?: number;
  onEntry?: (entry: AutomationLogEntry) => void;
  console?: boolean;
};

const cleanupKeys = new Set<string>();
const winstonSinkCache = new Map<string, WinstonSink>();
const secretKeyPattern = /(authorization|cookie|password|passwd|secret|token|api[-_]?key|webhook)/i;
const legacyPlatformTags = new Set([
  "baidu",
  "baidu-netdisk",
  "baidu-drama",
  "douyin-drama",
  "iqiyi-drama",
  "kuaishou-drama",
  "meituan-drama",
  "pinduoduo-drama",
  "qq-drama",
  "tiktok-drama",
  "wechat-drama",
  "wechat-miniprogram-drama",
]);

const consoleColorizer = winstonFormat.colorize();
consoleColorizer.addColors({
  debug: "magentaBright",
  info: "green",
  warn: "yellow",
  error: "red",
  context: "yellow",
  muted: "gray",
});
let lastConsoleLogAt: number | undefined;

export function createAutomationLogger(
  options: CreateAutomationLoggerOptions,
): AutomationLogger {
  // Automation services run in the Electron main process. Keep their structured
  // logs visible in an attached terminal by default; callers can still opt out
  // explicitly with `console: false`.
  const consoleEnabled = options.console ?? true;
  const sink = getWinstonSink({
    consoleEnabled,
    logFilePath: options.logFilePath,
    retentionDays: options.retentionDays ?? 3,
  });
  const write = (
    level: AutomationLogLevel,
    scope: string,
    context: AutomationLogFields,
    first: string | AutomationLogFields,
    second?: string | AutomationLogFields,
  ) => {
    const { message: rawMessage, fields } = resolveLogArguments(first, second);
    const parsed = parseLegacyMessage(rawMessage, scope);
    const message = normalizeMessage(parsed.message);
    const safeContext = redactFields(context);
    const safeDetails = redactFields(fields);
    const entry: AutomationLogEntry = {
      version: 1,
      pid: process.pid,
      time: formatLocalDateTime(new Date()),
      level,
      platform: options.platform,
      scope: inferScope(parsed.scope, message),
      message,
      ...(Object.keys(safeContext).length ? { context: safeContext } : {}),
      ...(Object.keys(safeDetails).length ? { details: safeDetails } : {}),
    };

    try {
      options.onEntry?.(entry);
    } catch {
      // One unavailable sink must not block the remaining sinks.
    }
    try {
      sink?.write(entry);
    } catch {
      // Logging is observational and must never change an automation result.
    }
  };

  const build = (scope: string, context: AutomationLogFields): AutomationLogger => ({
    debug: (first, second) => write("debug", scope, context, first, second),
    info: (first, second) => write("info", scope, context, first, second),
    warn: (first, second) => write("warn", scope, context, first, second),
    error: (first, second) => write("error", scope, context, first, second),
    child(childOptions) {
      return build(
        childOptions.scope ?? scope,
        { ...context, ...childOptions.context },
      );
    },
    callback(callbackScope = scope, callbackContext = {}) {
      return (message) => write(
        levelFromLegacyMessage(message),
        callbackScope,
        { ...context, ...callbackContext },
        message,
      );
    },
    async flush() {
      await sink?.flush();
    },
  });

  return build(options.scope ?? "runtime", options.context ?? {});
}

export function normalizeAutomationLogInput(
  input: AutomationLogInput,
  fallback: Pick<AutomationLogEntry, "platform" | "scope">,
): AutomationLogEntry {
  if (typeof input !== "string") return input;
  const parsed = parseLegacyMessage(input, fallback.scope);
  return {
    version: 1,
    pid: process.pid,
    time: formatLocalDateTime(new Date()),
    level: levelFromLegacyMessage(input),
    platform: fallback.platform,
    scope: parsed.scope,
    message: normalizeMessage(parsed.message),
  };
}

export function formatReadableLogEntry(entry: AutomationLogEntry) {
  const pid = entry.pid ?? process.pid;
  const level = formatLevel(entry.level);
  const context = formatLogContext(entry);
  const metadata = formatLogMetadata(entry);
  return `[Drama] ${pid} - ${entry.time} ${level.padStart(7)} ${context} ${entry.message}${metadata ? ` ${metadata}` : ""}`;
}

function formatConsoleLogEntry(entry: AutomationLogEntry) {
  const now = Date.now();
  const elapsed = lastConsoleLogAt === undefined ? undefined : now - lastConsoleLogAt;
  lastConsoleLogAt = now;
  const level = formatLevel(entry.level).padStart(7);
  const prefix = consoleColorizer.colorize(entry.level, `[Drama] ${entry.pid ?? process.pid} -`);
  const coloredLevel = consoleColorizer.colorize(entry.level, level);
  const context = consoleColorizer.colorize("context", formatLogContext(entry));
  const message = consoleColorizer.colorize(entry.level, entry.message);
  const metadata = formatLogMetadata(entry);
  const coloredMetadata = metadata
    ? ` ${consoleColorizer.colorize("muted", metadata)}`
    : "";
  const timestampDiff = elapsed === undefined || elapsed >= 60_000
    ? ""
    : consoleColorizer.colorize("context", ` +${elapsed}ms`);
  return `${prefix} ${entry.time} ${coloredLevel} ${context} ${message}${coloredMetadata}${timestampDiff}`;
}

function formatLevel(level: AutomationLogLevel) {
  return level === "info" ? "LOG" : level.toUpperCase();
}

function formatLogContext(entry: AutomationLogEntry) {
  return `[${formatIdentifier(entry.platform)}:${formatIdentifier(entry.scope)}]`;
}

function formatLogMetadata(entry: AutomationLogEntry) {
  const fields = { ...entry.context, ...entry.details };
  const detail = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatFieldValue(key, value)}`)
    .join(", ");
  return detail ? `{ ${detail} }` : "";
}

function formatIdentifier(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase() || "UNKNOWN";
}

export function formatDateKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function resolveLogArguments(
  first: string | AutomationLogFields,
  second?: string | AutomationLogFields,
) {
  if (typeof first === "string") {
    return {
      message: first,
      fields: typeof second === "object" && second ? second : {},
    };
  }
  return {
    message: typeof second === "string" ? second : "Log entry",
    fields: first,
  };
}

function parseLegacyMessage(message: string, fallbackScope: string) {
  let remaining = message.trim();
  let scope = fallbackScope;
  for (;;) {
    const match = /^\[([^\]]+)]\s*/.exec(remaining);
    if (!match) break;
    const tag = match[1].trim().toLowerCase();
    const mappedScope = scopeFromLegacyTag(tag);
    if (!legacyPlatformTags.has(tag) && !mappedScope) break;
    if (mappedScope) scope = mappedScope;
    remaining = remaining.slice(match[0].length).trim();
  }
  return { scope, message: remaining || "记录运行信息" };
}

function scopeFromLegacyTag(tag: string) {
  if (/^(account|api|auth|browser|config|download|form|material|notification|publish|runtime|storage|submit|system|task|upload|worker)$/.test(tag)) return tag;
  if (/^(task-api|idle-refresh|video-account-sync|video-transcode|resources|automation|polling|dropdown)$/.test(tag)) return tag;
  if (/^(baidu|baidu-transfer|disk-cleanup)$/.test(tag)) return "netdisk";
  if (/^(download|video-transcode.*)$/.test(tag)) return "download";
  if (/^(video-assets|material|poster)$/.test(tag)) return "material";
  if (/^(poster-material-invalid|image-compress-failed|local-video-invalid|production-proof-invalid)$/.test(tag)) return "material";
  if (/^(video-transcode-cancelled|video-transcode-failed)$/.test(tag)) return "video-transcode";
  if (/^(upload.*|vod.*)$/.test(tag)) return "upload";
  if (/^(login|check)$/.test(tag)) return "auth";
  if (/^(fill|form)$/.test(tag)) return "form";
  if (/^(task|step|retry|step-timeout)$/.test(tag)) return "task";
  if (/^(submit|action|wait)$/.test(tag)) return "submit";
  if (/^(browser|idle-refresh)$/.test(tag)) return "browser";
  if (/^(config)$/.test(tag)) return "config";
  if (/^(skip|warn|debug)$/.test(tag)) return fallbackScopeFromTag(tag);
  return undefined;
}

function fallbackScopeFromTag(tag: string) {
  return tag === "debug" ? "system" : "runtime";
}

function levelFromLegacyMessage(message: string): AutomationLogLevel {
  if (/\bfatal\b|阻断性/i.test(message)) return "error";
  if (/^\[(warn|skip|retry)]/i.test(message) || /\b(retry|retrying|fallback|skipped|timeout|warning|rejected)\b|重试|跳过|超时|警告|拒绝/i.test(message)) return "warn";
  if (/\b(failed|failure|error|失败|异常|错误)\b/i.test(message)) return "error";
  return "info";
}

function normalizeMessage(message: string) {
  return message
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.。]+$/, "");
}

function inferScope(scope: string, message: string) {
  if (scope !== "runtime" && scope !== "system") return scope;
  if (/登录|账号已登录|扫码|login|credential/i.test(message)) return "auth";
  if (/浏览器|页面|browser|tab\b/i.test(message)) return "browser";
  if (/网盘|下载|转存|netdisk|download/i.test(message)) return "netdisk";
  if (/封面|海报|权属|版权|素材|制作证明|cover|poster|material/i.test(message)) return "material";
  if (/上传|upload|VOD/i.test(message)) return "upload";
  if (/提交|提审|审核|submit|review/i.test(message)) return "submit";
  if (/填写|字段|选择|按钮|表单|角色|价格|fill|select|field|form|actor|price/i.test(message)) return "form";
  if (/接口|回调|上报|API/i.test(message)) return "api";
  if (/任务|领取|轮询|task|claim|poll/i.test(message)) return "task";
  return scope;
}

function formatLocalDateTime(date: Date) {
  const time = [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join(":");
  return `${formatDateKey(date)} ${time}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

function redactFields(fields: AutomationLogFields): AutomationLogFields {
  return Object.fromEntries(Object.entries(fields).flatMap(([key, value]) => {
    if (value === undefined) return [];
    return [[key, secretKeyPattern.test(key) ? "[REDACTED]" : redactValue(value, 0)]];
  }));
}

function redactValue(value: unknown, depth: number): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value === "string") return value.length > 4_000 ? `${value.slice(0, 4_000)}…` : value;
  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") return String(value);
  if (!value || typeof value !== "object") return value;
  if (depth >= 4) return "[MAX_DEPTH]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactValue(item, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    secretKeyPattern.test(key) ? "[REDACTED]" : redactValue(item, depth + 1),
  ]));
}

function formatFieldValue(key: string, value: unknown) {
  if (value instanceof Error) return normalizeMessage(parseLegacyMessage(value.message, "system").message);
  if (typeof value === "string") {
    const displayValue = /(?:error|message)$/i.test(key)
      ? normalizeMessage(parseLegacyMessage(value, "system").message)
      : value;
    return displayValue.replace(/\s+/g, " ").slice(0, 500);
  }
  if (typeof value === "number") {
    if (key === "timeoutMinutes") return `${value}m`;
    if (key === "size" || /Bytes$/.test(key)) return formatByteSize(value);
    return /(?:duration|delay|elapsed|interval|timeout).*ms$/i.test(key) || /Ms$/.test(key)
      ? `${value}ms`
      : String(value);
  }
  if (typeof value === "boolean" || value === null) return String(value);
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") {
      return normalizeMessage(parseLegacyMessage(message, "system").message)
        .replace(/\s+/g, " ")
        .slice(0, 500);
    }
  }
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return String(value).slice(0, 500);
  }
}

function formatByteSize(value: number) {
  if (!Number.isFinite(value) || value < 1_024) return `${value}B`;
  if (value < 1_024 * 1_024) return `${(value / 1_024).toFixed(1)}KB`;
  if (value < 1_024 * 1_024 * 1_024) return `${(value / 1_024 / 1_024).toFixed(1)}MB`;
  return `${(value / 1_024 / 1_024 / 1_024).toFixed(1)}GB`;
}

function readableLogFile(configuredPath: string) {
  return configuredPath.replace(/\.(?:jsonl|log)$/i, ".log");
}

function structuredLogFile(configuredPath: string) {
  const readablePath = readableLogFile(configuredPath);
  return path.join(
    path.dirname(readablePath),
    "structured",
    `${path.basename(readablePath, ".log")}.jsonl`,
  );
}

type WinstonLogInfo = {
  level: string;
  message: string;
  automationEntry: AutomationLogEntry;
};

type WinstonSink = {
  write(entry: AutomationLogEntry): void;
  flush(): Promise<void>;
};

function getWinstonSink(options: {
  consoleEnabled: boolean;
  logFilePath?: string;
  retentionDays: number;
}) {
  if (!options.consoleEnabled && !options.logFilePath) return undefined;
  const resolvedLogFilePath = options.logFilePath
    ? path.resolve(options.logFilePath)
    : undefined;
  const cacheKey = JSON.stringify({
    console: options.consoleEnabled,
    file: resolvedLogFilePath,
    retentionDays: options.retentionDays,
  });
  const cached = winstonSinkCache.get(cacheKey);
  if (cached) return cached;

  const created = createWinstonSink(
    {
      ...options,
      logFilePath: resolvedLogFilePath,
    },
    () => {
      if (winstonSinkCache.get(cacheKey) === created) winstonSinkCache.delete(cacheKey);
    },
  );
  winstonSinkCache.set(cacheKey, created);
  return created;
}

function createWinstonSink(options: {
  consoleEnabled: boolean;
  logFilePath?: string;
  retentionDays: number;
}, onClose: () => void): WinstonSink {
  const outputTransports: WinstonTransport[] = [];
  const fileTransports: WinstonTransport[] = [];

  if (options.consoleEnabled) {
    outputTransports.push(new winstonTransports.Console({
      level: "debug",
      format: consoleWinstonFormat(),
    }));
  }

  if (options.logFilePath) {
    const readablePath = readableLogFile(options.logFilePath);
    const structuredPath = structuredLogFile(options.logFilePath);
    mkdirSync(path.dirname(readablePath), { recursive: true });
    mkdirSync(path.dirname(structuredPath), { recursive: true });
    void cleanupAutomationLogFiles(readablePath, options.retentionDays).catch(() => undefined);

    const readableTransport = new winstonTransports.File({
      filename: readablePath,
      level: "debug",
      format: readableWinstonFormat(),
    });
    const structuredTransport = new winstonTransports.File({
      filename: structuredPath,
      level: "debug",
      format: structuredWinstonFormat(),
    });
    fileTransports.push(readableTransport, structuredTransport);
    outputTransports.push(readableTransport, structuredTransport);
  }

  const logger = createWinstonLogger({
    level: "debug",
    exitOnError: false,
    transports: outputTransports,
  });
  let closePromise: Promise<void> | undefined;
  let closed = false;
  logger.on("error", () => undefined);

  return {
    write(entry) {
      if (closed) return;
      try {
        logger.log({
          level: entry.level,
          message: entry.message,
          automationEntry: entry,
        });
      } catch {
        // Logging is observational and must never change an automation result.
      }
    },
    async flush() {
      closePromise ??= new Promise<void>((resolve) => {
        const finish = () => {
          closed = true;
          onClose();
          resolve();
        };
        logger.once("finish", finish);
        logger.once("error", finish);
        logger.end();
      });
      await closePromise;
    },
  };
}

function readableWinstonFormat() {
  return winstonFormat.printf((info) => {
    const entry = (info as unknown as WinstonLogInfo).automationEntry;
    return formatReadableLogEntry(entry);
  });
}

function consoleWinstonFormat() {
  return winstonFormat.printf((info) => {
    const entry = (info as unknown as WinstonLogInfo).automationEntry;
    return formatConsoleLogEntry(entry);
  });
}

function structuredWinstonFormat() {
  return winstonFormat.printf((info) => {
    const entry = (info as unknown as WinstonLogInfo).automationEntry;
    return JSON.stringify(entry);
  });
}

export async function cleanupAutomationLogFiles(configuredPath: string, retentionDays = 3) {
  const logDir = path.dirname(readableLogFile(configuredPath));
  const key = `${logDir}:${formatDateKey()}`;
  if (cleanupKeys.has(key)) return;
  cleanupKeys.add(key);
  const cutoff = Date.now() - Math.max(1, retentionDays) * 24 * 60 * 60 * 1_000;
  await Promise.all([logDir, path.join(logDir, "structured")].map(async (dir) => {
    await mkdir(dir, { recursive: true });
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile() || !/^app(?:-.+)?-\d{4}-\d{2}-\d{2}\.(?:jsonl|log)$/i.test(entry.name)) continue;
      const filePath = path.join(dir, entry.name);
      const fileStat = await stat(filePath).catch(() => undefined);
      if (fileStat && fileStat.mtimeMs < cutoff) await unlink(filePath).catch(() => undefined);
    }
  }));
}
