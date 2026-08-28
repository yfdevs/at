import type { IqiyiDramaApiConfig } from "../shared/types.js";

export type IqiyiDramaHttpClient = {
  post: <T>(path: string, payload: unknown) => Promise<T>;
};

export function createIqiyiDramaHttpClient(
  config: IqiyiDramaApiConfig,
): IqiyiDramaHttpClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? 30_000;

  return {
    async post<T>(requestPath: string, payload: unknown): Promise<T> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(
          `${baseUrl}${requestPath.startsWith("/") ? requestPath : `/${requestPath}`}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
        return await response.json() as T;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
