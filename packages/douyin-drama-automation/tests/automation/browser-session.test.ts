import assert from "node:assert/strict";
import test from "node:test";

import type { Page } from "playwright";

import {
  douyinDramaLoginStateFromUrl,
  waitForDouyinDramaEntryPageState,
} from "../../src/automation/browser-session.js";
import { DOUYIN_DRAMA_CREATE_URL, DOUYIN_DRAMA_LOGIN_URL } from "../../src/shared/constants.js";

const CREATE_PAGE_BODY = "上传漫剧 剧壳信息 基础信息 下一步";

function createPageProbe(states: Array<{ url: string; bodyText: string }>) {
  let index = 0;
  return {
    url: () => states[Math.min(index, states.length - 1)]!.url,
    locator: () => ({
      innerText: async () => states[Math.min(index, states.length - 1)]!.bodyText,
    }),
    waitForTimeout: async () => {
      index += 1;
    },
    title: async () => "短剧创作者中心",
  } as unknown as Page;
}

test("recognizes the Douyin login and authenticated page URLs", () => {
  assert.equal(douyinDramaLoginStateFromUrl(DOUYIN_DRAMA_LOGIN_URL), "login-required");
  assert.equal(douyinDramaLoginStateFromUrl(DOUYIN_DRAMA_CREATE_URL), "logged-in");
});

test("waits for a delayed redirect to the login page", async () => {
  const page = createPageProbe([
    { url: DOUYIN_DRAMA_CREATE_URL, bodyText: "" },
    { url: DOUYIN_DRAMA_LOGIN_URL, bodyText: "手机登录 密码登录" },
  ]);

  assert.equal(await waitForDouyinDramaEntryPageState(page, 1_000), "login-required");
});

test("reports logged in only after the create page content is ready", async () => {
  const page = createPageProbe([
    { url: DOUYIN_DRAMA_CREATE_URL, bodyText: "页面加载中" },
    { url: DOUYIN_DRAMA_CREATE_URL, bodyText: CREATE_PAGE_BODY },
  ]);

  assert.equal(await waitForDouyinDramaEntryPageState(page, 1_000), "logged-in");
});
