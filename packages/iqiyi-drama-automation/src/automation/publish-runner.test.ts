// oxlint-disable typescript/no-floating-promises
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const workspaceRoot = path.resolve(import.meta.dirname, "../../../../");
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(workspaceRoot, ".cache/playwright-browsers");

const [
  { chromium },
  { fillIqiyiNoCompanyFields, fillIqiyiPaymentFields },
  { iqiyiDramaTaskPayloadSchema },
  { createIqiyiDramaTaskFixture },
] = await Promise.all([
  import("playwright"),
  import("./publish-runner.js"),
  import("../shared/types.js"),
  import("../testing/task-fixture.js"),
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

const paymentFormHtml = `
  <div class="mp-form-item">
    <label class="mp-form-item__label">付费状态</label>
    <div class="mp-form-item__content">
      <label role="radio" aria-checked="true"><input name="payment" type="radio" value="付费" checked><span>付费</span></label>
      <label role="radio" aria-checked="false"><input name="payment" type="radio" value="免费"><span>免费</span></label>
    </div>
  </div>
  <div id="paid-fields">
    <div class="mp-form-item">
      <label class="mp-form-item__label">是否可转免</label>
      <div class="mp-form-item__content">
        <label role="radio" aria-checked="false"><input name="convertible" type="radio" value="是"><span>是</span></label>
        <label role="radio" aria-checked="false"><input name="convertible" type="radio" value="否"><span>否</span></label>
      </div>
    </div>
    <div class="mp-form-item">
      <label class="mp-form-item__label">开始付费集</label>
      <div class="mp-form-item__content"><input id="paid-start" type="text"></div>
    </div>
  </div>
  <script>
    const syncRadios = (name) => {
      document.querySelectorAll('input[name="' + name + '"]').forEach((input) => {
        input.closest('[role="radio"]').setAttribute('aria-checked', String(input.checked));
      });
    };
    document.querySelectorAll('input[type="radio"]').forEach((input) => {
      input.addEventListener('change', () => {
        syncRadios(input.name);
        if (input.name === 'payment') {
          document.querySelector('#paid-fields').style.display =
            document.querySelector('input[name="payment"]:checked').value === '付费' ? 'block' : 'none';
        }
      });
    });
  </script>
`;

function qualificationFormHtml(includeCoPresenter: boolean) {
  return `
    <div class="mp-form-item">
      <label class="mp-form-item__label">制作方</label>
      <div class="mp-form-item__content">
        <label role="radio" aria-checked="true"><input name="producer" type="radio" value="有制作方" checked><span>有制作方</span></label>
        <label role="radio" aria-checked="false"><input name="producer" type="radio" value="无制作方"><span>无制作方</span></label>
      </div>
    </div>
    ${includeCoPresenter ? `
      <div class="mp-form-item">
        <label class="mp-form-item__label">联合出品方</label>
        <div class="mp-form-item__content">
          <label role="radio" aria-checked="true"><input name="co-presenter" type="radio" value="有联合出品方" checked><span>有联合出品方</span></label>
          <label role="radio" aria-checked="false"><input name="co-presenter" type="radio" value="无联合出品方"><span>无联合出品方</span></label>
        </div>
      </div>
    ` : ""}
    <div role="dialog">确认选择无制作方<button type="button">确定</button></div>
    <script>
      document.querySelectorAll('input[type="radio"]').forEach((input) => {
        input.addEventListener('change', () => {
          document.querySelectorAll('input[name="' + input.name + '"]').forEach((item) => {
            item.closest('[role="radio"]').setAttribute('aria-checked', String(item.checked));
          });
        });
      });
    </script>
  `;
}

test("comic drama does not require the short-drama co-presenter field", { timeout: 15_000 }, async () => {
  const browser = await chromium.launch({ headless: true, executablePath: cachedChromiumExecutable });
  const page = await browser.newPage();
  try {
    await page.setContent(qualificationFormHtml(false));

    await fillIqiyiNoCompanyFields(page, {}, "comic-drama");

    assert.equal(await page.locator('input[name="producer"][value="无制作方"]').isChecked(), true);
    assert.equal(await page.getByText("联合出品方", { exact: true }).count(), 0);
  } finally {
    await browser.close();
  }
});

test("short drama still selects no co-presenter", { timeout: 15_000 }, async () => {
  const browser = await chromium.launch({ headless: true, executablePath: cachedChromiumExecutable });
  const page = await browser.newPage();
  try {
    await page.setContent(qualificationFormHtml(true));

    await fillIqiyiNoCompanyFields(page, {}, "short-drama");

    assert.equal(await page.locator('input[name="producer"][value="无制作方"]').isChecked(), true);
    assert.equal(
      await page.locator('input[name="co-presenter"][value="无联合出品方"]').isChecked(),
      true,
    );
  } finally {
    await browser.close();
  }
});

test("fills all paid short-drama settings", { timeout: 15_000 }, async () => {
  const browser = await chromium.launch({ headless: true, executablePath: cachedChromiumExecutable });
  const page = await browser.newPage();
  try {
    await page.setContent(paymentFormHtml);
    const payload = createIqiyiDramaTaskFixture().playlet;

    await fillIqiyiPaymentFields(page, {}, payload);

    assert.equal(await page.locator('input[name="payment"][value="付费"]').isChecked(), true);
    assert.equal(await page.locator('input[name="convertible"][value="是"]').isChecked(), true);
    assert.equal(await page.locator("#paid-start").inputValue(), "10");
  } finally {
    await browser.close();
  }
});

test("selects free without touching paid-only fields", { timeout: 15_000 }, async () => {
  const browser = await chromium.launch({ headless: true, executablePath: cachedChromiumExecutable });
  const page = await browser.newPage();
  try {
    await page.setContent(paymentFormHtml);
    const paidPayload = createIqiyiDramaTaskFixture().playlet;
    assert.equal(paidPayload.dramaType, "short-drama");
    assert.equal(paidPayload.paymentStatus, "付费");
    const {
      convertibleToFree: _convertibleToFree,
      paidStartEpisode: _paidStartEpisode,
      ...common
    } = paidPayload;
    const payload = iqiyiDramaTaskPayloadSchema.parse({ ...common, paymentStatus: "免费" });

    await fillIqiyiPaymentFields(page, {}, payload);

    assert.equal(await page.locator('input[name="payment"][value="免费"]').isChecked(), true);
    assert.equal(await page.locator("#paid-fields").isVisible(), false);
    assert.equal(await page.locator("#paid-start").inputValue(), "");
  } finally {
    await browser.close();
  }
});
