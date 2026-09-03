import { Clock, Effect } from "effect";

export type RetryWithDelaysOptions<E> = {
  readonly delaysMs: readonly number[];
  readonly while?: (error: E) => boolean;
};

/** Runs once immediately, then retries after each configured delay. */
export function retryWithDelays<A, E, R>(
  operation: (attempt: number) => Effect.Effect<A, E, R>,
  options: RetryWithDelaysOptions<E>,
): Effect.Effect<A, E, R> {
  return Effect.gen(function* () {
    let attempt = 0;
    for (;;) {
      const exit = yield* Effect.exit(operation(attempt));
      if (exit._tag === "Success") return exit.value;

      const error = exit.cause._tag === "Fail" ? exit.cause.error : undefined;
      const delayMs = options.delaysMs[attempt];
      if (
        error === undefined
        || delayMs === undefined
        || (options.while && !options.while(error))
      ) {
        return yield* Effect.failCause(exit.cause);
      }

      attempt += 1;
      if (delayMs > 0) yield* Effect.sleep(delayMs);
    }
  });
}

export type PollUntilOptions<A, E> = {
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly isDone: (value: A) => boolean;
  readonly onTimeout: (lastValue: A | undefined) => E;
};

export function pollUntil<A, E, E2, R>(
  operation: Effect.Effect<A, E, R>,
  options: PollUntilOptions<A, E2>,
): Effect.Effect<A, E | E2, R> {
  return Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis;
    let lastValue: A | undefined;

    for (;;) {
      lastValue = yield* operation;
      if (options.isDone(lastValue)) return lastValue;

      const elapsedMs = (yield* Clock.currentTimeMillis) - startedAt;
      if (elapsedMs >= options.timeoutMs) {
        return yield* Effect.fail(options.onTimeout(lastValue));
      }

      const remainingMs = options.timeoutMs - elapsedMs;
      yield* Effect.sleep(Math.min(Math.max(0, options.intervalMs), remainingMs));
    }
  });
}

export function scopedResource<A, E, R, B, E2, R2>(options: {
  readonly acquire: Effect.Effect<A, E, R>;
  readonly release: (resource: A) => Effect.Effect<void>;
  readonly use: (resource: A) => Effect.Effect<B, E2, R2>;
}): Effect.Effect<B, E | E2, R | R2> {
  return Effect.scoped(
    Effect.flatMap(
      Effect.acquireRelease(options.acquire, options.release),
      options.use,
    ),
  );
}
