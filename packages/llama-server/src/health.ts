import type { LlamaServerHealth } from "./types.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function checkLlamaServerHealth(
  baseURL: string,
  timeoutMs = 2_000,
  fetchImplementation: typeof fetch = fetch,
): Promise<LlamaServerHealth> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImplementation(`${baseURL.replace(/\/+$/, "")}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    const detail = (await response.text().catch(() => "")).trim();
    if (response.status === 200) {
      try {
        const body = JSON.parse(detail) as { status?: unknown };
        if (body.status === "ok") return { status: "ready", statusCode: 200 };
      } catch {
        // A 200 response from another process must not be mistaken for llama-server.
      }
    }

    return {
      status: "loading",
      statusCode: response.status,
      ...(detail ? { detail } : {}),
    };
  } catch (error) {
    return { status: "unreachable", detail: errorMessage(error) };
  } finally {
    clearTimeout(timeout);
  }
}
