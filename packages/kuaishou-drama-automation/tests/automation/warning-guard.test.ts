import assert from "node:assert/strict";
import test from "node:test";
import { isKuaishouDailyUploadLimitError } from "../../src/automation/warning-guard.js";

void test("identifies the Kuaishou daily drama upload limit warning", () => {
  assert.equal(
    isKuaishouDailyUploadLimitError(
      new Error(
        "KUAISHOU_DRAMA_WARNING_MESSAGE: 您今日的短剧上传已达上限，如有疑问，欢迎随时联系销售沟通处理",
      ),
    ),
    true,
  );
});

void test("does not pause task claims for unrelated Kuaishou warnings", () => {
  assert.equal(
    isKuaishouDailyUploadLimitError(
      new Error("KUAISHOU_DRAMA_WARNING_MESSAGE: 请先补充短剧版权证明材料"),
    ),
    false,
  );
});
