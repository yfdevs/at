// oxlint-disable typescript/no-floating-promises
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readdir } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = path.resolve(import.meta.dirname, "../../../../");
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(workspaceRoot, ".cache/playwright-browsers");

const [{ chromium }, { selectTaobaoFieldValue }] = await Promise.all([
  import("playwright"),
  import("../../src/automation/form-controls.js"),
]);

const browserCacheDir = path.join(workspaceRoot, ".cache/playwright-browsers");
const cachedChromiumDirectory = (await readdir(browserCacheDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
  .sort((left, right) => Number(right.name.split("-")[1]) - Number(left.name.split("-")[1]))[0];
assert.ok(cachedChromiumDirectory, "未找到仓库共享的 Chromium 测试浏览器");

const browser = await chromium.launch({
  headless: true,
  executablePath: path.join(
    browserCacheDir,
    cachedChromiumDirectory.name,
    "chrome-win64/chrome.exe",
  ),
});

after(async () => {
  await browser.close();
});

test("selects a radio field and two tags without confusing selected values with popup options", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <div class="ant-form-item">
        <label>付费方式</label>
        <label><input type="radio" name="payment" value="免费">免费</label>
        <label><input type="radio" name="payment" value="付费">付费</label>
      </div>
      <div class="ant-form-item" id="tag-field">
        <label>短剧标签</label>
        <div class="ant-select" role="combobox" tabindex="0">请选择标签</div>
        <div id="selected-tags"></div>
      </div>
      <div class="ant-select-dropdown" id="tag-options" style="display:none">
        <div class="ant-select-item-option" role="option">都市</div>
        <div class="ant-select-item-option" role="option">情感</div>
      </div>
      <script>
        const trigger = document.querySelector('#tag-field [role="combobox"]');
        const options = document.querySelector('#tag-options');
        trigger.addEventListener('click', () => { options.style.display = 'block'; });
        options.querySelectorAll('[role="option"]').forEach((option) => {
          option.addEventListener('click', () => {
            const token = document.createElement('span');
            token.className = 'ant-select-selection-item';
            token.setAttribute('aria-selected', 'true');
            token.textContent = option.textContent;
            document.querySelector('#selected-tags').append(token);
          });
        });
      </script>
    `);

    await selectTaobaoFieldValue(page, ["付费方式"], "免费");
    await selectTaobaoFieldValue(page, ["短剧标签"], "都市", true);
    await selectTaobaoFieldValue(page, ["短剧标签"], "情感", true);
    await selectTaobaoFieldValue(page, ["短剧标签"], "都市", true);

    assert.equal(await page.locator("input[value='免费']").isChecked(), true);
    assert.deepEqual(
      await page.locator(".ant-select-selection-item").allTextContents(),
      ["都市", "情感"],
    );
  } finally {
    await page.close();
  }
});

test("does not click unrelated page text when a dropdown option is missing", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <div class="next-form-item" id="audience-field">
        <label>观看受众</label>
        <div class="next-select" role="combobox" tabindex="0">请选择</div>
      </div>
      <button id="unrelated">女频</button>
      <script>
        window.unrelatedClicked = false;
        document.querySelector('#unrelated').addEventListener('click', () => {
          window.unrelatedClicked = true;
        });
      </script>
    `);

    await assert.rejects(
      selectTaobaoFieldValue(page, ["观看受众"], "女频"),
      /TAOBAO_DRAMA_SELECT_OPTION_NOT_FOUND/u,
    );
    assert.equal(await page.evaluate(() => (window as unknown as { unrelatedClicked: boolean }).unrelatedClicked), false);
  } finally {
    await page.close();
  }
});
