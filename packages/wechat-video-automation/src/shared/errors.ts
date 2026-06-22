export enum ErrorType {
  Unknown = "UNKNOWN",
  Configuration = "CONFIGURATION",
  ApiRequest = "API_REQUEST",
  ApiResponse = "API_RESPONSE",
  Authentication = "AUTHENTICATION",
  ChannelState = "CHANNEL_STATE",
  TaskClaim = "TASK_CLAIM",
  TaskExecution = "TASK_EXECUTION",
  StepTimeout = "STEP_TIMEOUT",
  Validation = "VALIDATION",
  Upload = "UPLOAD",
  LocalFile = "LOCAL_FILE",
  Browser = "BROWSER",
}

export type RpaFailStage = "LOGIN" | "FILL_FORM" | "UPLOAD_FILE" | "SUBMIT" | "RECOGNIZE_RESULT" | "OTHER";

export interface StandardErrorInfo {
  type: ErrorType;
  name: string;
  message: string;
  stack?: string;
  failStage?: RpaFailStage;
}

const errorTypeRules: Array<[ErrorType, RegExp]> = [
  [ErrorType.StepTimeout, /\[step-timeout\]|timeout|timed out/i],
  [ErrorType.Upload, /\[upload-failed\]|upload|上传|未能上传/i],
  [ErrorType.LocalFile, /\[local-video-invalid\]|file not found|directory|目录不存在|本地文件/i],
  [ErrorType.Validation, /validation|invalid|required|must|empty|校验|提示|不能为空|不存在/i],
  [ErrorType.Authentication, /login|required login|登录|scan|扫码/i],
  [ErrorType.ChannelState, /Unknown channelId|Channel is|reserved|busy|video account/i],
  [ErrorType.TaskClaim, /claim task|claim loop|account task page|领取/i],
  [ErrorType.ApiRequest, /HTTP \d{3}|ECONN|ETIMEDOUT|ENOTFOUND|Axios|REQUEST|POST|GET|PUT|DELETE/i],
  [ErrorType.ApiResponse, /response data|payloadJson|code=\d+|接口|响应/i],
  [ErrorType.Configuration, /config|ENV|apiBaseUrl|localEpisodeVideoRoot/i],
  [ErrorType.Browser, /browser|page|locator|playwright|chromium|context/i],
];

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function extractName(error: unknown): string {
  if (error instanceof Error) return error.name;
  return typeof error;
}

export function classifyError(error: unknown, fallbackType = ErrorType.Unknown): StandardErrorInfo {
  const message = extractMessage(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const typedError = error as { errorType?: unknown; failStage?: unknown; type?: unknown };
  const explicitType = typedError.errorType ?? typedError.type;
  const failStage = typeof typedError.failStage === "string" && isRpaFailStage(typedError.failStage)
    ? typedError.failStage
    : undefined;

  if (typeof explicitType === "string" && Object.values(ErrorType).includes(explicitType as ErrorType)) {
    return {
      type: explicitType as ErrorType,
      name: extractName(error),
      message,
      stack,
      failStage,
    };
  }

  const matchedRule = errorTypeRules.find(([, pattern]) => pattern.test(message));
  return {
    type: matchedRule?.[0] ?? fallbackType,
    name: extractName(error),
    message,
    stack,
    failStage,
  };
}

export function getErrorMessage(error: unknown): string {
  return extractMessage(error);
}

export function isRpaFailStage(value: string): value is RpaFailStage {
  return ["LOGIN", "FILL_FORM", "UPLOAD_FILE", "SUBMIT", "RECOGNIZE_RESULT", "OTHER"].includes(value);
}

export function attachFailStage(error: unknown, failStage: RpaFailStage): Error {
  if (error instanceof Error) {
    Object.assign(error, { failStage });
    return error;
  }

  return Object.assign(new Error(String(error)), { failStage });
}

export function inferRpaFailStage(errorType: ErrorType, explicitFailStage?: RpaFailStage): RpaFailStage {
  if (explicitFailStage) return explicitFailStage;
  switch (errorType) {
    case ErrorType.Authentication:
      return "LOGIN";
    case ErrorType.Upload:
    case ErrorType.LocalFile:
      return "UPLOAD_FILE";
    case ErrorType.Validation:
      return "FILL_FORM";
    default:
      return "OTHER";
  }
}
