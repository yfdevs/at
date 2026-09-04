import assert from "node:assert/strict";
import test from "node:test";

import { Effect } from "effect";

import {
  downloadBaiduNetdiskShare,
  downloadBaiduNetdiskShareEffect,
} from "../../src/workflows/download-baidu-folder.js";
import {
  CdpConnectionError,
  InvalidShareInputError,
  RemoteMaterialValidationError,
  ShareExtractionError,
  classifyBaiduNetdiskAutomationError,
} from "../../src/domain/errors.js";

void test("classifies invalid share input without relying on callers parsing messages", () => {
  const error = classifyBaiduNetdiskAutomationError(
    new Error("分享文本中没有找到百度网盘分享链接。"),
  );
  assert.ok(error instanceof InvalidShareInputError);
  assert.equal(error._tag, "InvalidShareInputError");
});

void test("classifies captcha and expired shares as extraction failures", () => {
  const captcha = classifyBaiduNetdiskAutomationError(new Error("分享页要求验证码。"));
  const expired = classifyBaiduNetdiskAutomationError(new Error("分享已过期。"));
  assert.ok(captcha instanceof ShareExtractionError);
  assert.ok(expired instanceof ShareExtractionError);
});

void test("preserves an existing typed automation error", () => {
  const original = new CdpConnectionError({ message: "CDP closed", port: 9337 });
  assert.equal(classifyBaiduNetdiskAutomationError(original), original);
});

void test("material validation errors expose machine-readable material counts", () => {
  const error = new RemoteMaterialValidationError({
    material: "poster",
    expected: 1,
    actual: 0,
    message: "百度网盘海报封面数量不足。",
  });

  assert.equal(error._tag, "RemoteMaterialValidationError");
  assert.equal(error.material, "poster");
  assert.equal(error.expected, 1);
  assert.equal(error.actual, 0);
  assert.equal(classifyBaiduNetdiskAutomationError(error), error);
});

void test("download effect exposes invalid input through the typed error channel", async () => {
  const exit = await Effect.runPromiseExit(
    downloadBaiduNetdiskShareEffect({ shareText: "not a baidu share" }),
  );
  assert.equal(exit._tag, "Failure");
  if (exit._tag === "Failure") {
    const error = exit.cause._tag === "Fail" ? exit.cause.error : undefined;
    assert.ok(error instanceof InvalidShareInputError);
  }
});

void test("download Promise preserves typed failures for non-Effect consumers", async () => {
  await assert.rejects(
    downloadBaiduNetdiskShare({ shareText: "not a baidu share" }),
    (error: unknown) => {
      assert.ok(error instanceof InvalidShareInputError);
      assert.equal(error._tag, "InvalidShareInputError");
      return true;
    },
  );
});
