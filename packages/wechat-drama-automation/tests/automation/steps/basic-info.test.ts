// oxlint-disable typescript/no-floating-promises
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const workspaceRoot = path.resolve(import.meta.dirname, "../../../../../");
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(workspaceRoot, ".cache/playwright-browsers");

const [{ chromium }, { setAiContentDeclaration }] = await Promise.all([
  import("playwright"),
  import("../../../src/automation/steps/basic-info.js"),
]);

const browserCacheDir = path.join(workspaceRoot, ".cache/playwright-browsers");
const cachedChromiumDirectory = (await readdir(browserCacheDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
  .sort((left, right) => Number(right.name.split("-")[1]) - Number(left.name.split("-")[1]))[0];
assert.ok(cachedChromiumDirectory, "未找到仓库共享的 Chromium 测试浏览器");
const cachedChromiumExecutable = path.join(
  browserCacheDir,
  cachedChromiumDirectory.name,
  "chrome-win64/chrome.exe",
);

test("sets the labeled AI declaration switch to both requested states", {
  timeout: 15000,
}, async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: cachedChromiumExecutable,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  try {
    await page.setContent(`
      <style>
        wujie-app { display: block; min-height: 200px; }
        .weui-desktop-switch__input { position: absolute; left: -10000px; }
        .weui-desktop-switch__box { display: inline-block; width: 44px; height: 24px; background: #ddd; }
      </style>
      <wujie-app>
        <div class="weui-desktop-form__control-group">
          <label class="weui-desktop-form__label">AI内容声明</label>
          <label for="ai-content-switch">
            <input id="ai-content-switch" class="weui-desktop-switch__input" type="checkbox">
            <i class="weui-desktop-switch__box"></i>
          </label>
        </div>
      </wujie-app>
    `);

    const checkbox = page.locator("#ai-content-switch");
    assert.equal(await page.locator("wujie-app:visible").count(), 1);
    assert.equal(await page.locator(".weui-desktop-form__control-group:visible").count(), 1);
    await setAiContentDeclaration(page, true);
    assert.equal(await checkbox.isChecked(), true);

    await setAiContentDeclaration(page, true);
    assert.equal(await checkbox.isChecked(), true);

    await setAiContentDeclaration(page, false);
    assert.equal(await checkbox.isChecked(), false);
  } finally {
    await browser.close();
  }
});
