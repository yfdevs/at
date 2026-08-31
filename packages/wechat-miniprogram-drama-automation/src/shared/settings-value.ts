export function numberSetting(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function integerSetting(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function booleanSetting(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return value.trim().toLowerCase() !== "false";
}

export function secondsToMs(seconds: number): number {
  return seconds * 1000;
}

export function minutesToMs(minutes: number): number {
  return secondsToMs(minutes * 60);
}

export function hoursToMs(hours: number): number {
  return minutesToMs(hours * 60);
}

export function secondsSettingToMs(value: string | undefined, fallbackSeconds: number): number {
  return secondsToMs(numberSetting(value, fallbackSeconds));
}
