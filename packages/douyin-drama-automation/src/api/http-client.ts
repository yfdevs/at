import type { DouyinDramaApiConfig } from "../shared/types.js";

export type DouyinDramaHttpClient = {
  post: <T>(path: string, payload: unknown) => Promise<T>;
};

export function createDouyinDramaHttpClient(
  config: DouyinDramaApiConfig,
): DouyinDramaHttpClient {
  const baseUrl = config.baseUrl.trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("DOUYIN_DRAMA_API_BASE_URL_REQUIRED");
  return {
    async post<T>(path: string, payload: unknown): Promise<T> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 30_000);
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
          throw new Error(
            `DOUYIN_DRAMA_API_REQUEST_FAILED: path=${path} status=${response.status}`,
          );
        }
        return await response.json() as T;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

