// oxlint-disable typescript/no-floating-promises
import assert from "node:assert/strict";
import test from "node:test";

import { fetchDouyinDramaAccounts } from "../../src/api/account-config.js";

test("loads enabled Douyin accounts from the backend account page", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const accounts = await fetchDouyinDramaAccounts(
    "http://api.example.test/",
    async (input, init) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return new Response(JSON.stringify({
        code: 0,
        msg: null,
        data: {
          total: 4,
          data: [
            { id: 4, accountId: "off", accountName: "停用账号", status: "OFF", sortNo: 0 },
            { id: 2, accountId: "dy-second", accountName: "第二账号", status: "ON", sortNo: 20 },
            { id: 1, accountId: "dy-first", accountName: "第一账号", status: "ON", sortNo: 10 },
            { id: 3, accountId: "dy-first", accountName: "重复账号", status: "ON", sortNo: 30 },
          ],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  );

  assert.equal(
    requests[0]?.url,
    "http://api.example.test/dramaAiRpa/douyin/accountConfig/page",
  );
  assert.deepEqual(requests[0]?.body, {
    page: 1,
    pageSize: 100,
    accountId: null,
    accountName: null,
    status: "ON",
  });
  assert.deepEqual(accounts.map((account) => account.accountId), ["dy-first", "dy-second"]);
  assert.equal(accounts[0]?.accountName, "重复账号");
});

test("rejects an unsuccessful Douyin account response", async () => {
  await assert.rejects(
    () => fetchDouyinDramaAccounts("http://api.example.test", async () =>
      new Response(JSON.stringify({ code: 401, msg: "未授权", data: null }), { status: 200 })),
    /DOUYIN_DRAMA_ACCOUNT_CONFIG_REQUEST_FAILED: code=401/u,
  );
});
