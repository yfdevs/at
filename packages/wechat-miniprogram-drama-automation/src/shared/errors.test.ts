// oxlint-disable typescript/no-floating-promises
import assert from "node:assert/strict";
import test from "node:test";
import { classifyError, ErrorType } from "./errors.js";

test("classifies an offscreen Playwright input failure as a browser error", () => {
  const error = new Error(
    "locator.setChecked: Element is outside of the viewport; waiting for locator('input[type=\"checkbox\"]')",
  );
  assert.equal(classifyError(error).type, ErrorType.Browser);
});

test("continues to classify explicit HTTP method requests as API errors", () => {
  assert.equal(classifyError(new Error("PUT /dramaAiRpa/wechatMiniProgram/rpa/task failed")).type, ErrorType.ApiRequest);
});
