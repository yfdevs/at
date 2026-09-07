import type { TencentHuolongApiConfig } from "../shared/types.js";

export type TencentHuolongHttpClient = {
  post: <T>(path: string, payload: unknown) => Promise<T>;
};

export function createTencentHuolongHttpClient(config: TencentHuolongApiConfig): TencentHuolongHttpClient {
  const baseUrl = config.baseUrl.trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("TENCENT_HUOLONG_DRAMA_API_BASE_URL_REQUIRED");
  return {
    async post<T>(path: string, payload: unknown) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 30_000);
      try {
        const response = await fetch(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
        return await response.json() as T;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
