type NullToUndefined<T> = {
  [K in keyof T]: Exclude<T[K], null> | (null extends T[K] ? undefined : never);
};

export function nullsToUndefined<T extends Record<string, unknown>>(record: T): NullToUndefined<T> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, value === null ? undefined : value]),
  ) as NullToUndefined<T>;
}
