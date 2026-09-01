// oxlint-disable typescript/no-floating-promises
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createMockIqiyiDramaTask } from "../api/task.js";

const workspaceRoot = path.resolve(import.meta.dirname, "../../../../");
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(workspaceRoot, ".cache/playwright-browsers");

const [{ chromium }, { uploadIqiyiEpisodeVideos }] = await Promise.all([
  import("playwright"),
  import("./video-upload.js"),
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

const fixtureRoot = await mkdtemp(path.join(tmpdir(), "iqiyi-episode-upload-"));
const localMaterialRoot = path.join(fixtureRoot, "materials");
const assetDownloadDir = path.join(fixtureRoot, "assets");
const resourceName = "爱奇艺正片上传测试剧";
const episodeDir = path.join(localMaterialRoot, resourceName);
await mkdir(episodeDir, { recursive: true });
await mkdir(assetDownloadDir, { recursive: true });
await Promise.all([1, 2].map((index) =>
  writeFile(path.join(episodeDir, `${resourceName}-第${index}集.mp4`), `episode-${index}`)
));

after(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

function taskWithTwoEpisodes() {
  const task = createMockIqiyiDramaTask();
  task.originalTitle = resourceName;
  task.playlet.title = "正片上传测试剧";
  task.playlet.episodeCount = 2;
  return task;
}

function uploadFixtureScript(status: "success" | "fail") {
  return `
    document.querySelector('#episode-files').addEventListener('change', (event) => {
      const list = document.querySelector('#episode-list');
      for (const file of Array.from(event.currentTarget.files)) {
        const row = document.createElement('div');
        row.className = 'catalog-item-form';
        row.innerHTML = [
          '<div class="catalog-form-text">' + file.name + '</div>',
          '<div class="file-status"><svg data-upload-status="${status}"></svg></div>',
          ${status === "fail" ? "'<div class=\"mp-form-item__error\">上传失败</div>'" : "''"},
        ].join('');
        list.appendChild(row);
      }
    });
  `;
}

test("uploads all comic-drama episodes and waits for terminal success rows", {
  timeout: 20_000,
}, async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: cachedChromiumExecutable,
  });
  const page = await browser.newPage();

  try {
    await page.setContent(`
      <div class="proj-catalog-wrap">
        <p class="upload-title">上传视频</p>
        <input id="episode-files" type="file" multiple accept=".mp4,.mov,.mkv">
        <div id="episode-list"></div>
      </div>
      <script>${uploadFixtureScript("success")}</script>
    `);

    await uploadIqiyiEpisodeVideos(page, taskWithTwoEpisodes(), {
      localMaterialRoot,
      assetDownloadDir,
      videoUploadTimeoutMinutes: 1,
    });

    const uploadedNames = await page.locator(".catalog-form-text").allInnerTexts();
    assert.deepEqual(uploadedNames, ["正片上传测试剧-第1集.mp4", "正片上传测试剧-第2集.mp4"]);
    const leftovers = (await readdir(assetDownloadDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("episode-upload-"));
    assert.equal(leftovers.length, 0);
  } finally {
    await browser.close();
  }
});

test("does not allow save flow to continue when any episode upload fails", {
  timeout: 20_000,
}, async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: cachedChromiumExecutable,
  });
  const page = await browser.newPage();

  try {
    await page.setContent(`
      <div class="proj-catalog-wrap">
        <p class="upload-title">上传视频</p>
        <input id="episode-files" type="file" multiple accept=".mp4,.mov,.mkv">
        <div id="episode-list"></div>
      </div>
      <script>${uploadFixtureScript("fail")}</script>
    `);

    await assert.rejects(
      () => uploadIqiyiEpisodeVideos(page, taskWithTwoEpisodes(), {
        localMaterialRoot,
        assetDownloadDir,
        videoUploadTimeoutMinutes: 1,
      }),
      /IQIYI_DRAMA_VIDEO_UPLOAD_FAILED/u,
    );
  } finally {
    await browser.close();
  }
});
