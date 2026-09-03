import assert from "node:assert/strict";
import test from "node:test";

import { isBlankMeituanAppRoot } from "../../src/automation/browser-session.js";

test("treats a comment-only Meituan app root as a blank page", () => {
  assert.equal(isBlankMeituanAppRoot({
    exists: true,
    childElementCount: 0,
    text: "",
    html: "<!--app-html-->",
  }), true);
});

test("does not treat a rendered or missing Meituan app root as blank", () => {
  assert.equal(isBlankMeituanAppRoot({
    exists: true,
    childElementCount: 1,
    text: "",
    html: "<div class=\"loading\"></div>",
  }), false);
  assert.equal(isBlankMeituanAppRoot({
    exists: true,
    childElementCount: 0,
    text: "发布至合集",
    html: "发布至合集",
  }), false);
  assert.equal(isBlankMeituanAppRoot({
    exists: false,
    childElementCount: 0,
    text: "",
    html: "",
  }), false);
});
