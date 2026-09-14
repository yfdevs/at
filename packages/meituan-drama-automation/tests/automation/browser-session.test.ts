import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright";

import { isBlankMeituanAppRoot, waitForLogin } from "../../src/automation/browser-session.js";
import { MEITUAN_CREATION_LOGIN_URL, MEITUAN_CREATION_PUBLISH_VIDEO_URL } from "../../src/shared/constants.js";

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

test("blank publish page opens login page without clearing the saved session", async () => {
  let currentUrl = MEITUAN_CREATION_PUBLISH_VIDEO_URL;
  let blankSamples = 0;
  let reloads = 0;
  let clearedCookies = false;
  let clearedStorage = false;
  const page = {
    getByText: () => ({ isVisible: async () => false }),
    waitForLoadState: async () => undefined,
    evaluate: async (callback: () => unknown) => {
      if (callback.toString().includes(".clear()")) clearedStorage = true;
      blankSamples += 1;
      return { exists: true, childElementCount: 0, text: "", html: "<!--app-html-->" };
    },
    waitForTimeout: async () => undefined,
    reload: async () => { reloads += 1; },
    url: () => currentUrl,
    context: () => ({ clearCookies: async () => { clearedCookies = true; } }),
    goto: async (url: string) => { currentUrl = url; },
    waitForFunction: async () => undefined,
  } as unknown as Page;

  const result = await waitForLogin(page, {});

  assert.deepEqual(result, { recoveredBlankPage: true });
  assert.equal(blankSamples, 6);
  assert.equal(reloads, 1);
  assert.equal(currentUrl, MEITUAN_CREATION_LOGIN_URL);
  assert.equal(clearedCookies, false);
  assert.equal(clearedStorage, false);
});

test("a blank publish page that recovers on reload keeps the user signed in", async () => {
  let reloaded = false;
  let openedLoginPage = false;
  const page = {
    getByText: () => ({ isVisible: async () => reloaded }),
    waitForLoadState: async () => undefined,
    evaluate: async () => ({ exists: true, childElementCount: 0, text: "", html: "" }),
    waitForTimeout: async () => undefined,
    url: () => MEITUAN_CREATION_PUBLISH_VIDEO_URL,
    reload: async () => { reloaded = true; },
    goto: async () => { openedLoginPage = true; },
  } as unknown as Page;

  const result = await waitForLogin(page, {});

  assert.deepEqual(result, { recoveredBlankPage: false });
  assert.equal(openedLoginPage, false);
});
