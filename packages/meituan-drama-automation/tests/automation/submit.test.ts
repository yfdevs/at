import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";

import {
  installMeituanSubmitErrorCapture,
  waitForMeituanSubmitSettle,
} from "../../src/automation/steps/submit.js";

function launchTestBrowser() {
  const executablePath = fileURLToPath(new URL(
    "../../../../.cache/playwright-browsers/chromium-1228/chrome-win64/chrome.exe",
    import.meta.url,
  ));
  return chromium.launch({ executablePath, headless: true });
}

test("reports a transient Meituan error message during the submit settle window", async () => {
  const browser = await launchTestBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent("<main>提交处理中</main>");
    await installMeituanSubmitErrorCapture(page);
    await page.evaluate(() => {
      setTimeout(() => {
        const message = document.createElement("div");
        message.className = "mtd-message mtd-message-error";
        message.setAttribute("role", "alert");
        message.innerHTML = '<span class="mtd-message-content">合集名称已存在，请修改后重试</span>';
        document.body.append(message);
        setTimeout(() => message.remove(), 30);
      }, 30);
    });

    await assert.rejects(
      waitForMeituanSubmitSettle(page, { settleMs: 400, pollIntervalMs: 100 }),
      /MEITUAN_SUBMIT_FAILED: 合集名称已存在，请修改后重试/u,
    );
  } finally {
    await browser.close();
  }
});

test("accepts a Meituan submit only after the full error-free settle window", async () => {
  const browser = await launchTestBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent("<main>提交处理中</main>");
    await installMeituanSubmitErrorCapture(page);
    const startedAt = Date.now();
    await waitForMeituanSubmitSettle(page, { settleMs: 300, pollIntervalMs: 50 });
    assert.ok(Date.now() - startedAt >= 300);
  } finally {
    await browser.close();
  }
});
