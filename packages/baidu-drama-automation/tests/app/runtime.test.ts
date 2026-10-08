import assert from "node:assert/strict";
import test from "node:test";

import { isBaiduInformationConfirmNotClosedError } from "../../src/app/runtime.js";

test("retries only when the Baidu information confirmation dialog stays open", () => {
  assert.equal(
    isBaiduInformationConfirmNotClosedError(
      new Error("BAIDU_DRAMA_INFORMATION_CONFIRM_NOT_CLOSED"),
    ),
    true,
  );
  assert.equal(
    isBaiduInformationConfirmNotClosedError(
      new Error("BAIDU_DRAMA_TYPE_CHANGE_CONFIRM_NOT_CLOSED"),
    ),
    false,
  );
});
