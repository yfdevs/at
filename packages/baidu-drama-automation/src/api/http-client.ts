import type { BaiduDramaApiConfig } from "../shared/types.js";

export type BaiduDramaHttpClient = {
  post: <T>(path: string, payload: unknown) => Promise<T>;
};

export function createBaiduDramaHttpClient(
  config: BaiduDramaApiConfig,
): BaiduDramaHttpClient {
  const baseUrl = config.baseUrl.trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("BAIDU_DRAMA_API_BASE_URL_REQUIRED");
  const timeoutMs = config.timeoutMs ?? 30_000;

  return {
    async post<T>(path: string, payload: unknown): Promise<T> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(
          `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`,
          {
            method: "POST",
            headers: {
              accept: "application/json, text/plain, */*",
              "content-type": "application/json;charset=UTF-8",
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
        return (await response.json()) as T;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
