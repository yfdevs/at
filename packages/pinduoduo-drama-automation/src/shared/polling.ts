import type { PinduoduoDramaRuntimeOptions } from "./types.js";

export const PINDUODUO_DEFAULT_TASK_POLL_INTERVAL_MINUTES = 120;

export function pinduoduoTaskPollIntervalMs(
  options: PinduoduoDramaRuntimeOptions | undefined,
): number {
  const configuredValue = options?.config?.taskPollIntervalMinutes;
  const parsedValue = Number.parseInt(String(configuredValue ?? ""), 10);
  const minutes =
    Number.isFinite(parsedValue) && parsedValue > 0
      ? parsedValue
      : PINDUODUO_DEFAULT_TASK_POLL_INTERVAL_MINUTES;

  return minutes * 60 * 1000;
}
