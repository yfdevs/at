import assert from "node:assert/strict";
import test from "node:test";

import { fetchWechatMiniProgramAccountsApi } from "../../src/api/mini-program-accounts.js";

// oxlint-disable-next-line typescript/no-floating-promises
test("returns the independent WeChat Mini Program mock account list", async () => {
  const accounts = await fetchWechatMiniProgramAccountsApi();

  assert.deepEqual(
    accounts.map((account) => account.id),
    ["wxmp-mock-002"],
  );
  assert.equal(new Set(accounts.map((account) => account.id)).size, accounts.length);
  assert.ok(accounts.every((account) => account.name.length > 0));
  assert.ok(accounts.every((account) => account.contractSubject === undefined));
});
