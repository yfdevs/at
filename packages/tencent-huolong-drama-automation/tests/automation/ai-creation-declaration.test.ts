// oxlint-disable typescript/no-floating-promises
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const workspaceRoot = path.resolve(import.meta.dirname, "../../../../");
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(workspaceRoot, ".cache/playwright-browsers");

const [
  { chromium },
  {
    fillTencentHuolongAiCreationDeclaration,
    fillTencentHuolongNonInfringementCommitment,
    resolveFile,
  },
  {
    tencentHuolongAiCreationDeclarationFile,
    tencentHuolongNonInfringementCommitmentFile,
  },
] = await Promise.all([
  import("playwright"),
  import("../../src/automation/form-controls.js"),
  import("../../src/shared/fixed-assets.js"),
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

const browser = await chromium.launch({
  headless: true,
  executablePath: cachedChromiumExecutable,
});

after(async () => {
  await browser.close();
});

test("checks the AI declaration before uploading the bundled PDF", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <div data-field-name="cp_statement">
        <label>
          <input id="ai-confirmation" type="checkbox">
          <span>我确认本作品为全AI创作内容</span>
        </label>
        <div id="ai-declaration" data-field-name="ai_creation_declaration" hidden>
          <button type="button">上传文件</button>
          <input id="ai-declaration-file" hidden accept="application/pdf" type="file">
        </div>
      </div>
      <script>
        document.querySelector('#ai-confirmation').addEventListener('change', (event) => {
          document.querySelector('#ai-declaration').hidden = !event.currentTarget.checked;
        });
      </script>
    `);

    await fillTencentHuolongAiCreationDeclaration(page, {});

    assert.equal(await page.locator("#ai-confirmation").isChecked(), true);
    assert.equal(await page.locator("#ai-declaration").isVisible(), true);
    const uploadedNames = await page.locator("#ai-declaration-file").evaluate(
      (element) => Array.from((element as HTMLInputElement).files ?? [], (file) => file.name),
    );
    assert.deepEqual(uploadedNames, ["AI创作声明.pdf"]);
    assert.equal(path.basename(tencentHuolongAiCreationDeclarationFile), "AI创作声明.pdf");
    assert.equal(path.basename(tencentHuolongNonInfringementCommitmentFile), "权利声明.pdf");
  } finally {
    await page.close();
  }
});

test("materializes an inlined PDF asset before Playwright upload", async () => {
  const assetDownloadDir = await mkdtemp(path.join(tmpdir(), "huolong-fixed-asset-"));
  try {
    const file = await resolveFile(
      "data:application/pdf;base64,JVBERi0xLjcK",
      { assetDownloadDir },
    );
    assert.equal(path.extname(file), ".pdf");
    assert.deepEqual(await readFile(file), Buffer.from("%PDF-1.7\n"));
  } finally {
    await rm(assetDownloadDir, { recursive: true, force: true });
  }
});

test("uploads the bundled rights declaration as the non-infringement commitment", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <div data-field-name="personal_commitment_letter_file">
        <button type="button">上传文件</button>
        <input id="non-infringement-file" hidden accept="application/pdf" type="file">
      </div>
    `);

    await fillTencentHuolongNonInfringementCommitment(page, {});

    const uploadedNames = await page.locator("#non-infringement-file").evaluate(
      (element) => Array.from((element as HTMLInputElement).files ?? [], (file) => file.name),
    );
    assert.deepEqual(uploadedNames, ["权利声明.pdf"]);
  } finally {
    await page.close();
  }
});
