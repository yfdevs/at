// oxlint-disable typescript/no-floating-promises
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const workspaceRoot = path.resolve(import.meta.dirname, "../../../../");
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(workspaceRoot, ".cache/playwright-browsers");

const [
  { chromium },
  { clickIqiyiButton, fillIqiyiField, selectFirstIqiyiOption, uploadIqiyiFiles },
] = await Promise.all([
  import("playwright"),
  import("./form-controls.js"),
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

const fixtureDir = await mkdtemp(path.join(tmpdir(), "iqiyi-proof-upload-"));
const proofFiles = await Promise.all(
  ["制作合同-1.jpg", "制作合同-2.jpg", "版权证明-1.jpg", "版权证明-2.jpg"].map(
    async (name) => {
      const file = path.join(fixtureDir, name);
      await writeFile(file, name);
      return file;
    },
  ),
);

after(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

test("clicks the exact 提交项目 button instead of a save action", async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: cachedChromiumExecutable,
  });
  const page = await browser.newPage();

  try {
    await page.setContent(`
      <button type="button" id="save">保存项目</button>
      <button type="button" id="submit-review">提交审核</button>
      <button type="button" id="submit-project">提交项目</button>
      <script>
        window.clickedAction = '';
        document.querySelectorAll('button').forEach((button) => {
          button.addEventListener('click', () => { window.clickedAction = button.id; });
        });
      </script>
    `);

    assert.equal(await clickIqiyiButton(page, ["提交项目"]), "提交项目");
    assert.equal(
      await page.evaluate(() => (window as unknown as { clickedAction: string }).clickedAction),
      "submit-project",
    );
  } finally {
    await browser.close();
  }
});

test("uploads every file from both copyright arrays", { timeout: 15000 }, async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: cachedChromiumExecutable,
  });
  const page = await browser.newPage();

  try {
    await page.setContent(`
      <div class="upload-slot">
        <span>知识产权声明文件</span>
        <input id="production-proofs" type="file" multiple>
      </div>
      <div class="upload-slot">
        <span>版权证明文件</span>
        <input id="license-proofs" type="file">
      </div>
      <script>
        window.licenseUploads = [];
        document.querySelector('#license-proofs').addEventListener('change', (event) => {
          window.licenseUploads.push(...Array.from(event.currentTarget.files, (file) => file.name));
        });
      </script>
    `);

    await uploadIqiyiFiles(page, {}, {
      aliases: ["知识产权声明文件"],
      files: proofFiles.slice(0, 2),
      required: true,
    });
    await uploadIqiyiFiles(page, {}, {
      aliases: ["版权证明文件"],
      files: proofFiles.slice(2),
      required: true,
    });

    const productionNames = await page.locator("#production-proofs").evaluate(
      (element) => Array.from((element as HTMLInputElement).files ?? [], (file) => file.name),
    );
    const licenseNames = await page.evaluate(() => (window as unknown as {
      licenseUploads: string[];
    }).licenseUploads);
    assert.deepEqual(productionNames, ["制作合同-1.jpg", "制作合同-2.jpg"]);
    assert.deepEqual(licenseNames, ["版权证明-1.jpg", "版权证明-2.jpg"]);
  } finally {
    await browser.close();
  }
});

test("selects the fixed no-company values through custom mp-radio controls", {
  timeout: 15000,
}, async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: cachedChromiumExecutable,
  });
  const page = await browser.newPage();

  try {
    await page.setContent(`
      <style>
        body { min-height: 2200px; }
        .mp-form-item { margin-top: 1500px; }
        .mp-radio { pointer-events: none; }
        .mp-radio__original { position: absolute; left: -10000px; }
      </style>
      <div class="mp-form-item">
        <label for="hasProductionList" class="mp-form-item__label" style="width: 220px;">制作方</label>
        <div class="mp-form-item__content" style="margin-left: 220px;">
          <div role="radiogroup" class="mp-radio-group">
            <label role="radio" aria-checked="true" class="mp-radio is-checked">
              <span class="mp-radio__input is-checked">
                <span class="mp-radio__inner"></span>
                <input name="hasProductionList" type="radio" class="mp-radio__original" value="1" checked>
              </span>
              <span class="mp-radio__label">有制作方</span>
            </label>
            <label role="radio" aria-checked="false" class="mp-radio">
              <span class="mp-radio__input">
                <span class="mp-radio__inner"></span>
                <input name="hasProductionList" type="radio" class="mp-radio__original" value="0">
              </span>
              <span class="mp-radio__label">无制作方</span>
            </label>
          </div>
        </div>
      </div>
      <div class="mp-form-item">
        <label for="hasCoPresenterList" class="mp-form-item__label" style="width: 220px;">联合出品方</label>
        <div class="mp-form-item__content" style="margin-left: 220px;">
          <div role="radiogroup" class="mp-radio-group">
            <label role="radio" aria-checked="true" class="mp-radio is-checked">
              <span class="mp-radio__input is-checked">
                <span class="mp-radio__inner"></span>
                <input name="hasCoPresenterList" type="radio" class="mp-radio__original" value="1" checked>
              </span>
              <span class="mp-radio__label">有联合出品方</span>
            </label>
            <label role="radio" aria-checked="false" class="mp-radio">
              <span class="mp-radio__input">
                <span class="mp-radio__inner"></span>
                <input name="hasCoPresenterList" type="radio" class="mp-radio__original" value="0">
              </span>
              <span class="mp-radio__label">无联合出品方</span>
            </label>
          </div>
        </div>
      </div>
      <script>
        document.querySelectorAll('.mp-radio__original').forEach((input) => {
          input.addEventListener('change', () => {
            document.querySelectorAll('.mp-radio').forEach((label) => {
              const currentInput = label.querySelector('.mp-radio__original');
              label.setAttribute('aria-checked', String(currentInput.checked));
              label.classList.toggle('is-checked', currentInput.checked);
              label.querySelector('.mp-radio__input').classList.toggle('is-checked', currentInput.checked);
            });
          });
        });
      </script>
    `);

    await fillIqiyiField(page, {}, {
      aliases: ["制作方"],
      value: "无制作方",
      kind: "choice",
      required: true,
    });
    await fillIqiyiField(page, {}, {
      aliases: ["联合出品方"],
      value: "无联合出品方",
      kind: "choice",
      required: true,
    });

    assert.equal(await page.locator('input[name="hasProductionList"][value="0"]').isChecked(), true);
    assert.equal(
      await page.locator('input[name="hasCoPresenterList"][value="0"]').isChecked(),
      true,
    );
    assert.equal(
      await page.locator("label[role='radio']")
        .filter({ hasText: /^\s*无制作方\s*$/u })
        .getAttribute("aria-checked"),
      "true",
    );
    assert.equal(
      await page.locator("label[role='radio']")
        .filter({ hasText: /^\s*无联合出品方\s*$/u })
        .getAttribute("aria-checked"),
      "true",
    );
  } finally {
    await browser.close();
  }
});

test("fills the short-drama 分类 radio and multiple 标签 checkboxes", { timeout: 15000 }, async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: cachedChromiumExecutable,
  });
  const page = await browser.newPage();

  try {
    await page.setContent(`
      <div class="mp-form-item">
        <label class="mp-form-item__label">分类</label>
        <div class="mp-form-item__content">
          <label role="radio" aria-checked="false"><input name="category" type="radio"><span>男频</span></label>
          <label role="radio" aria-checked="false"><input name="category" type="radio"><span>女频</span></label>
        </div>
      </div>
      <div class="mp-form-item">
        <label class="mp-form-item__label">标签</label>
        <div class="mp-form-item__content">
          <label role="checkbox" aria-checked="false"><input id="urban" type="checkbox"><span>都市</span></label>
          <label role="checkbox" aria-checked="false"><input id="revenge" type="checkbox"><span>复仇</span></label>
        </div>
      </div>
    `);

    await fillIqiyiField(page, {}, {
      aliases: ["分类"],
      value: "男频",
      kind: "choice",
      required: true,
    });
    for (const tag of ["都市", "复仇"]) {
      await fillIqiyiField(page, {}, {
        aliases: ["标签"],
        value: tag,
        kind: "choice",
        required: true,
      });
    }

    assert.equal(await page.locator("input[name='category']").first().isChecked(), true);
    assert.equal(await page.locator("#urban").isChecked(), true);
    assert.equal(await page.locator("#revenge").isChecked(), true);
  } finally {
    await browser.close();
  }
});

test("confirms the 设置封面图 mp-popup after cover upload", { timeout: 20000 }, async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: cachedChromiumExecutable,
  });
  const page = await browser.newPage();

  try {
    await page.setContent(`
      <div class="upload-slot">
        <span>封面编辑</span>
        <input id="cover-files" type="file" multiple>
      </div>
      <div id="cover-popup" class="mp-popup base-popup-block" style="display: none; width: 800px;">
        <div class="mp-popup-title">设置封面图</div>
        <div class="mp-popup-content">
          <div class="ratio-title">裁剪16:9</div>
          <div class="thumbnail-preview"><img alt="16:9 preview"></div>
          <div class="cropper-container"></div>
        </div>
        <div class="mp-popup-btn">
          <button type="button">取消</button>
          <button id="cover-confirm" type="button">确定</button>
        </div>
      </div>
      <script>
        document.querySelector('#cover-files').addEventListener('change', () => {
          document.querySelector('#cover-popup').style.display = 'block';
        });
        document.querySelector('#cover-confirm').addEventListener('click', (event) => {
          event.currentTarget.dataset.clicked = 'true';
          document.querySelector('#cover-popup').style.display = 'none';
        });
      </script>
    `);

    await uploadIqiyiFiles(page, {}, {
      aliases: ["封面编辑", "封面"],
      files: proofFiles.slice(0, 2),
      required: true,
      settleCoverEditor: true,
    });

    assert.equal(await page.locator("#cover-confirm").getAttribute("data-clicked"), "true");
    assert.equal(await page.locator("#cover-popup").isVisible(), false);
  } finally {
    await browser.close();
  }
});

test("selects the first available 签约意向 option without a task value", { timeout: 15000 }, async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: cachedChromiumExecutable,
  });
  const page = await browser.newPage();

  try {
    await page.setContent(`
      <div class="mp-form-item">
        <label class="mp-form-item__label" for="intentionType">签约意向</label>
        <div class="mp-form-item__content">
          <div class="mp-select intention-select">
            <input id="intentionType" readonly placeholder="请选择签约意向">
          </div>
        </div>
      </div>
      <ul id="intention-options" style="display:none">
        <li class="mp-select-pulldown__item">内容合作协议</li>
        <li class="mp-select-pulldown__item">其他合作协议</li>
      </ul>
      <script>
        const input = document.querySelector('#intentionType');
        const options = document.querySelector('#intention-options');
        input.addEventListener('click', () => { options.style.display = 'block'; });
        options.querySelectorAll('.mp-select-pulldown__item').forEach((option) => {
          option.addEventListener('click', () => {
            input.value = option.textContent;
            input.dataset.selected = option.textContent;
            options.style.display = 'none';
          });
        });
      </script>
    `);

    const selected = await selectFirstIqiyiOption(page, {}, {
      aliases: ["签约意向"],
      placeholders: ["请选择签约意向"],
      required: true,
    });

    assert.equal(selected, "内容合作协议");
    assert.equal(await page.locator("#intentionType").getAttribute("data-selected"), "内容合作协议");
    assert.equal(await page.locator("#intentionType").inputValue(), "内容合作协议");
  } finally {
    await browser.close();
  }
});
