import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Config } from "../../shared/types.js";

const workspaceRoot = path.resolve(import.meta.dirname, "../../../../../");
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(workspaceRoot, ".cache/playwright-browsers");

const [{ chromium }, { selectUploadedEpisodeFilesStep }, { configureWechatMiniProgramRuntimeSettings }]
  = await Promise.all([
    import("playwright"),
    import("./episodes.js"),
    import("../../shared/runtime-settings.js"),
  ]);

const runDataDir = await mkdtemp(path.join(tmpdir(), "wechat-episode-selection-"));
configureWechatMiniProgramRuntimeSettings({ runDataDir });

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

after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
  await rm(runDataDir, { recursive: true, force: true });
});

function selectionRow(title: string, episode: number): string {
  return `
    <tr>
      <td class="weui-desktop-table__tr-border media-table-row col1">
        <label class="weui-desktop-form__check-label">
          <input type="checkbox" checking="" class="weui-desktop-form__checkbox" value="${episode}">
          <i class="weui-desktop-icon-checkbox"></i>
        </label>
      </td>
      <td class="weui-desktop-table__tr-border media-table-row col2">
        <div>${title}-第${episode}集.mp4</div>
      </td>
      <td class="weui-desktop-table__tr-border media-table-row col3">60MB</td>
      <td class="weui-desktop-table__tr-border media-table-row col4">2026-08-31 11:17:24</td>
    </tr>`;
}

test("selects every exact episode from the current WeChat media-library table", {
  timeout: 15000,
}, async () => {
  const title = "赶海救下美人鱼，她让整片大海来报恩";
  const episodes = [9, 5, 2, 10, 6, 7, 4, 3, 8, 1];
  const browser = await chromium.launch({
    headless: true,
    executablePath: cachedChromiumExecutable,
  });
  const page = await browser.newPage();

  try {
    await page.setContent(`
      <input placeholder="搜索文件名">

      <!-- 页面上其他可见表格不能进入选集扫描。 -->
      <table id="unrelated-table">
        <tbody>
          ${Array.from({ length: 5 }, (_, index) => `<tr><td>证明材料 ${index + 1}</td></tr>`).join("")}
        </tbody>
      </table>

      <table id="episode-library" class="weui-desktop-table__core-table">
        <thead>
          <tr>
            <th class="media-table-row col1"></th>
            <th class="media-table-row col2">文件名</th>
            <th class="media-table-row col3">文件大小</th>
            <th class="media-table-row col4">上传时间</th>
          </tr>
        </thead>
        <tbody>
          ${episodes.map((episode) => selectionRow(title, episode)).join("")}
          ${selectionRow(title, 11)}
        </tbody>
      </table>

      <div class="table-operation-left">已选 0 / 10 集</div>
      <button type="button" id="confirm">确认提审</button>
      <script>
        const table = document.querySelector('#episode-library');
        const summary = document.querySelector('.table-operation-left');
        const refreshSummary = () => {
          const selected = table.querySelectorAll('tbody input[type="checkbox"]:checked').length;
          summary.textContent = '已选 ' + selected + ' / 10 集';
        };
        table.querySelectorAll('tbody input[type="checkbox"]').forEach((checkbox) => {
          checkbox.addEventListener('input', refreshSummary);
          checkbox.addEventListener('change', refreshSummary);
        });
        document.querySelector('#confirm').addEventListener('click', (event) => {
          event.currentTarget.dataset.clicked = 'true';
        });
      </script>
    `);

    const config = {
      originalTitle: title,
      playlet: { name: title, episodeCount: episodes.length },
    } as Config;
    const startedAt = Date.now();
    await selectUploadedEpisodeFilesStep(page, config);

    const selected = await page.locator("#episode-library tbody input:checked")
      .evaluateAll((inputs) => inputs.map((input) => Number((input as HTMLInputElement).value)));
    assert.deepEqual(selected.sort((left, right) => left - right), episodes.slice().sort((left, right) => left - right));
    assert.equal(await page.locator('#episode-library input[value="11"]').isChecked(), false);
    assert.equal(await page.locator(".table-operation-left").innerText(), "已选 10 / 10 集");
    assert.equal(await page.locator("#confirm").getAttribute("data-clicked"), "true");
    assert.ok(Date.now() - startedAt < 7000, "10 集选取不应出现逐行兜底等待");
  } finally {
    await browser.close();
  }
});
