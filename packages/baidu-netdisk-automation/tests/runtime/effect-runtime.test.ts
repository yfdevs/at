import assert from "node:assert/strict";
import test from "node:test";

import { Effect } from "effect";

import { openCdpPageEffect, withPageEffect } from "../../src/infrastructure/cdp.js";
import { CdpConnectionError, CdpTimeoutError } from "../../src/domain/errors.js";
import { pollUntil, retryWithDelays, scopedResource } from "../../src/runtime/effect-runtime.js";
import type { CdpTarget } from "../../src/domain/types.js";

void test("retryWithDelays retries recoverable failures and returns the successful value", async () => {
  let attempts = 0;
  const result = await Effect.runPromise(
    retryWithDelays(
      () => Effect.gen(function* () {
        attempts += 1;
        if (attempts < 3) return yield* Effect.fail("temporary");
        return "ready";
      }),
      { delaysMs: [0, 0] },
    ),
  );

  assert.equal(result, "ready");
  assert.equal(attempts, 3);
});

void test("retryWithDelays does not retry a non-recoverable failure", async () => {
  let attempts = 0;
  const exit = await Effect.runPromiseExit(
    retryWithDelays(
      () => {
        attempts += 1;
        return Effect.fail("fatal");
      },
      { delaysMs: [0, 0], while: (error) => error !== "fatal" },
    ),
  );

  assert.equal(exit._tag, "Failure");
  assert.equal(attempts, 1);
});

void test("pollUntil repeats until the predicate succeeds", async () => {
  let attempts = 0;
  const result = await Effect.runPromise(
    pollUntil(
      Effect.sync(() => ++attempts),
      {
        intervalMs: 0,
        timeoutMs: 1_000,
        isDone: (value) => value === 3,
        onTimeout: () => new CdpTimeoutError({
          message: "poll timeout",
          operation: "test",
          timeoutMs: 1_000,
        }),
      },
    ),
  );

  assert.equal(result, 3);
  assert.equal(attempts, 3);
});

void test("pollUntil fails with the configured typed timeout", async () => {
  const exit = await Effect.runPromiseExit(
    pollUntil(
      Effect.succeed(false),
      {
        intervalMs: 1,
        timeoutMs: 2,
        isDone: Boolean,
        onTimeout: () => new CdpTimeoutError({
          message: "poll timeout",
          operation: "test",
          timeoutMs: 2,
        }),
      },
    ),
  );

  assert.equal(exit._tag, "Failure");
  if (exit._tag === "Failure") {
    const error = exit.cause._tag === "Fail" ? exit.cause.error : undefined;
    assert.ok(error instanceof CdpTimeoutError);
  }
});

void test("scopedResource always releases an acquired resource after failure", async () => {
  let released = false;
  const exit = await Effect.runPromiseExit(
    scopedResource({
      acquire: Effect.succeed({ id: 1 }),
      release: () => Effect.sync(() => {
        released = true;
      }),
      use: () => Effect.fail("failed"),
    }),
  );

  assert.equal(exit._tag, "Failure");
  assert.equal(released, true);
});

const target: CdpTarget = {
  id: "target-1",
  title: "test",
  type: "page",
  url: "https://pan.baidu.com/",
  webSocketDebuggerUrl: "ws://example.test",
};

void test("openCdpPageEffect closes a page when opening it fails", async () => {
  let closed = false;
  const exit = await Effect.runPromiseExit(
    openCdpPageEffect(target, () => ({
      async open() {
        throw new Error("connect failed");
      },
      close() {
        closed = true;
      },
    })),
  );

  assert.equal(exit._tag, "Failure");
  assert.equal(closed, true);
  if (exit._tag === "Failure") {
    const error = exit.cause._tag === "Fail" ? exit.cause.error : undefined;
    assert.ok(error instanceof CdpConnectionError);
  }
});

void test("withPageEffect closes a page when the operation fails", async () => {
  let closed = false;
  const exit = await Effect.runPromiseExit(
    withPageEffect(
      target,
      () => Effect.fail("operation failed"),
      () => ({
        async open() {},
        close() {
          closed = true;
        },
      }),
    ),
  );

  assert.equal(exit._tag, "Failure");
  assert.equal(closed, true);
});
