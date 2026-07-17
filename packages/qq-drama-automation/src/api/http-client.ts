import type { QqDramaApiConfig } from "../shared/types.js";

export type QqDramaHttpClient = {
  post: <T>(path: string, payload: unknown) => Promise<T>;
};

// 创建 QQ 上剧业务接口 HTTP 客户端，统一处理 baseUrl、超时和 JSON POST 请求。
export function createQqDramaHttpClient(config: QqDramaApiConfig): QqDramaHttpClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? 30_000;

  return {
    async post<T>(path: string, payload: unknown): Promise<T> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

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
