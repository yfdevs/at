// oxlint-disable typescript/no-floating-promises
import assert from "node:assert/strict";
import test from "node:test";

import {
  createMockDouyinDramaAccounts,
  isMockDouyinDramaAccountId,
} from "../../src/api/mock-account.js";

test("returns an independent temporary Douyin account list", () => {
  const first = createMockDouyinDramaAccounts();
  const second = createMockDouyinDramaAccounts();

  assert.deepEqual(first.map((account) => account.accountId), ["17732354154"]);
  assert.equal(first[0]?.accountName, "17732354154");
  assert.equal(first[0]?.loginAccount, "17732354154");
  assert.equal(isMockDouyinDramaAccountId(first[0]?.accountId), true);
  assert.notEqual(first, second);
  assert.notEqual(first[0], second[0]);
});
