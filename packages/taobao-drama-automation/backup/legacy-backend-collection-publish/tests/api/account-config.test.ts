// oxlint-disable typescript/no-floating-promises
import assert from "node:assert/strict";
import test from "node:test";

import { fetchTaobaoDramaAccounts } from "../../src/api/account-config.js";

test("loads enabled Taobao accounts from the Taobao API prefix", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const accounts = await fetchTaobaoDramaAccounts("http://api.example.test/", async (input, init) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({
      code: 0,
      msg: "操作成功",
      data: {
        total: 3,
        data: [
          { id: 3, accountId: "off", accountName: "停用账号", status: "OFF", sortNo: 0 },
          { id: 2, accountId: "second", accountName: null, status: "ON", sortNo: 20 },
          { id: 1, accountId: "first", accountName: "第一账号", status: "ON", sortNo: 10 },
        ],
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  assert.equal(requests[0]?.url, "http://api.example.test/dramaAiRpa/taobao/accountConfig/page");
  assert.deepEqual(requests[0]?.body, {
    page: 1,
    pageSize: 100,
    accountId: null,
    accountName: null,
    status: "ON",
  });
  assert.deepEqual(accounts.map((account) => account.accountId), ["first", "second"]);
  assert.equal(accounts[1]?.accountName, "second");
});

test("rejects an unsuccessful Taobao account response", async () => {
  await assert.rejects(
    () => fetchTaobaoDramaAccounts("http://api.example.test", async () =>
      new Response(JSON.stringify({ code: 500, msg: "系统异常", data: null }), { status: 200 })),
    /TAOBAO_DRAMA_ACCOUNT_CONFIG_REQUEST_FAILED: code=500/u,
  );
});
