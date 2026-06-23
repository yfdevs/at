import { type AxiosError, type AxiosResponse } from "axios";

import type { ApiResponseEnvelope } from "./apiResponseTypes.js";

export enum ApiHttpStatusCode {
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  INTERNAL_SERVER_ERROR = 500,
}

const STATUS_MESSAGE_MAP: Record<number, string> = {
  [ApiHttpStatusCode.UNAUTHORIZED]: "登录状态已过期，请重新登录",
  [ApiHttpStatusCode.FORBIDDEN]: "没有权限访问该资源",
  [ApiHttpStatusCode.NOT_FOUND]: "请求的资源不存在",
  [ApiHttpStatusCode.INTERNAL_SERVER_ERROR]: "服务器异常，请稍后重试",
};

const DEFAULT_ERROR_MESSAGE = "请求失败，请稍后再试";
const NETWORK_ERROR_MESSAGE = "网络连接异常，请检查网络后重试";

const isApiEnvelope = (payload: unknown): payload is ApiResponseEnvelope<unknown> => {
  return (
    !!payload &&
    typeof payload === "object" &&
    "success" in payload &&
    "message" in payload &&
    "code" in payload
  );
};

export const unwrapApiResponseData = (response: AxiosResponse) => {
  const result = response.data;

  if (isApiEnvelope(result) && result.success) {
    response.data = result.data;
  }

  return response;
};

export const handleApiResponseError = (error: AxiosError) => {
  let message = DEFAULT_ERROR_MESSAGE;

  if (error.response) {
    const { status, data } = error.response;

    if (data && typeof data === "object" && ("error" in data || "message" in data)) {
      const apiResponse = data as Partial<ApiResponseEnvelope<unknown>>;
      message = apiResponse.error || apiResponse.message || message;
    } else {
      message = STATUS_MESSAGE_MAP[status] || `请求失败（状态码 ${status}）`;
    }
  } else if (error.request) {
    message = NETWORK_ERROR_MESSAGE;
  }

  console.error("API Error:", message, error);

  return Promise.reject(error);
};
