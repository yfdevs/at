import assert from "node:assert/strict";
import test from "node:test";

import {
  isTaobaoCreatorSuccessNavigation,
  isTaobaoTargetUrl,
  taobaoLoginStateFromPage,
  taobaoLoginStateFromUrl,
} from "../../src/automation/browser-session.js";

test("recognizes Taobao login, security verification and creator states", () => {
  assert.equal(taobaoLoginStateFromUrl("https://login.taobao.com/havanaone/login/login.htm"), "login-required");
  assert.equal(taobaoLoginStateFromUrl("https://aq.taobao.com/verify"), "verification-required");
  assert.equal(taobaoLoginStateFromUrl("https://creator.guanghe.taobao.com/page/unify/collect-create"), "logged-in");
  assert.equal(taobaoLoginStateFromUrl("not-a-url"), "unknown");
});

test("page verification and login signals override creator host URL", () => {
  const creatorUrl = "https://creator.guanghe.taobao.com/page/unify/collect-create";
  assert.equal(taobaoLoginStateFromPage(creatorUrl, "请完成安全验证 滑块验证"), "verification-required");
  assert.equal(taobaoLoginStateFromPage(creatorUrl, "登录淘宝 手机扫码登录"), "login-required");
  assert.equal(taobaoLoginStateFromPage(creatorUrl, "合集类型 短剧类型"), "logged-in");
});

test("recognizes both Taobao workflow target pages", () => {
  assert.equal(isTaobaoTargetUrl(
    "https://creator.guanghe.taobao.com/page/unify/collect-create?type=1",
    "collection",
  ), true);
  assert.equal(isTaobaoTargetUrl(
    "https://creator.guanghe.taobao.com/page/unify/creation-tool/batch-publish?ugc_scene=short_drama_multipublish",
    "batch",
  ), true);
  assert.equal(isTaobaoTargetUrl("https://login.taobao.com/", "collection"), false);
  assert.equal(isTaobaoTargetUrl(
    "https://evil.example/?next=https://creator.guanghe.taobao.com/page/unify/collect-create",
    "collection",
  ), false);
});

test("only accepts safe creator-host navigation as a workflow success signal", () => {
  assert.equal(isTaobaoCreatorSuccessNavigation(
    "https://creator.guanghe.taobao.com/page/unify/collection",
    "collection",
  ), true);
  assert.equal(isTaobaoCreatorSuccessNavigation(
    "https://login.taobao.com/havanaone/login/login.htm",
    "collection",
  ), false);
  assert.equal(isTaobaoCreatorSuccessNavigation(
    "https://creator.guanghe.taobao.com/error",
    "collection",
  ), false);
  assert.equal(isTaobaoCreatorSuccessNavigation(
    "https://creator.guanghe.taobao.com/page/unify/collect-create?mode=1",
    "collection",
  ), false);
});
