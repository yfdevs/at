import assert from "node:assert/strict";
import test from "node:test";
import { baiduDramaBrowserPageTitle } from "../../src/automation/browser-session.js";

test("builds a recognizable Baidu browser title from account name and id", () => {
  assert.equal(
    baiduDramaBrowserPageTitle({
      baiduAccountName: "百度账号甲",
      baiduAccountId: "baidu-1001",
    }),
    "[百度短剧] 百度账号甲（baidu-1001）",
  );
});

test("falls back to the profile name when account metadata is unavailable", () => {
  assert.equal(
    baiduDramaBrowserPageTitle({ accountProfileName: "profile-a" }),
    "[百度短剧] profile-a",
  );
});
