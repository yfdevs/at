// oxlint-disable typescript/no-floating-promises
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createIqiyiDramaTaskFixture } from "../testing/task-fixture.js";

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
const twoEpisodeResourceName = "爱奇艺正片上传测试剧";
const sixtyFourEpisodeResourceName = "爱奇艺正片输入重建测试剧";
await mkdir(assetDownloadDir, { recursive: true });

async function createEpisodeFixtures(resourceName: string, episodeCount: number) {
  const episodeDir = path.join(localMaterialRoot, resourceName);
  await mkdir(episodeDir, { recursive: true });
  await Promise.all(Array.from({ length: episodeCount }, (_, index) => index + 1).map((index) =>
    writeFile(path.join(episodeDir, `${resourceName}-第${index}集.mp4`), `episode-${index}`)
  ));
}

await Promise.all([
  createEpisodeFixtures(twoEpisodeResourceName, 2),
  createEpisodeFixtures(sixtyFourEpisodeResourceName, 64),
]);

after(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

function taskWithTwoEpisodes() {
  const task = createIqiyiDramaTaskFixture();
  task.originalTitle = twoEpisodeResourceName;
  task.playlet.title = "正片上传测试剧";
  task.playlet.episodeCount = 2;
  return task;
}

function taskWithTwoShortDramaEpisodes() {
  const task = taskWithTwoEpisodes();
  task.playlet.dramaType = "short-drama";
  return task;
}

function taskWithSixtyFourEpisodes() {
  const task = createIqiyiDramaTaskFixture();
  task.originalTitle = sixtyFourEpisodeResourceName;
  task.playlet.title = "输入重建稳定性测试剧";
  task.playlet.episodeCount = 64;
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

function singleFileRecreatingInputFixtureScript() {
  return `
    const root = document.querySelector('.proj-catalog-wrap');
    const list = document.querySelector('#episode-list');
    let selectionCount = 0;
    let maximumSelectionSize = 0;

    function mountInput() {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = '.mp4,.mov,.mkv';
      input.addEventListener('change', (event) => {
        const files = Array.from(event.currentTarget.files);
        selectionCount += 1;
        maximumSelectionSize = Math.max(maximumSelectionSize, files.length);
        document.body.dataset.selectionCount = String(selectionCount);
        document.body.dataset.maximumSelectionSize = String(maximumSelectionSize);

        const file = files[0];
        event.currentTarget.remove();
        mountInput();
        if (!file) return;

        const row = document.createElement('div');
        row.className = 'catalog-item-form';
        row.innerHTML = [
          '<div class="catalog-form-text">' + file.name + '</div>',
          '<div class="file-status"><svg data-upload-status="success"></svg></div>',
        ].join('');
        list.appendChild(row);
      });
      root.appendChild(input);
    }

    mountInput();
  `;
}

function batchFileChooserRecreatingInputFixtureScript() {
  return `
    const root = document.querySelector('.proj-catalog-wrap');
    const trigger = document.querySelector('.catalog-upload-video-wrap');
    const list = document.querySelector('#episode-list');
    let selectionCount = 0;
    let maximumSelectionSize = 0;

    function mountInput() {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = '.mp4,.mov,.mkv';
      input.style.cssText = 'position:fixed;width:0;height:0;opacity:0';
      input.addEventListener('change', (event) => {
        const files = Array.from(event.currentTarget.files);
        selectionCount += 1;
        maximumSelectionSize = Math.max(maximumSelectionSize, files.length);
        document.body.dataset.selectionCount = String(selectionCount);
        document.body.dataset.maximumSelectionSize = String(maximumSelectionSize);

        event.currentTarget.remove();
        mountInput();
        for (const file of files) {
          const row = document.createElement('div');
          row.className = 'catalog-item-form';
          row.innerHTML = [
            '<div class="catalog-form-text">' + file.name + '</div>',
            '<div class="file-status"><svg data-upload-status="success"></svg></div>',
          ].join('');
          list.appendChild(row);
        }
      });
      root.appendChild(input);
    }

    trigger.addEventListener('click', () => {
      root.querySelector('input[type="file"]').click();
    });
    mountInput();
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

test("uploads all short-drama episodes through the shared batch uploader", {
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
        <div class="catalog-upload-video-wrap"><p class="upload-title">上传视频</p></div>
        <input id="episode-files" type="file" multiple accept=".mp4,.mov,.mkv">
        <div id="episode-list"></div>
      </div>
      <script>
        document.querySelector('.catalog-upload-video-wrap').addEventListener('click', () => {
          document.querySelector('#episode-files').click();
        });
        ${uploadFixtureScript("success")}
      </script>
    `);

    await uploadIqiyiEpisodeVideos(page, taskWithTwoShortDramaEpisodes(), {
      localMaterialRoot,
      assetDownloadDir,
      videoUploadTimeoutMinutes: 1,
    });

    assert.deepEqual(
      await page.locator(".catalog-form-text").allInnerTexts(),
      ["正片上传测试剧-第1集.mp4", "正片上传测试剧-第2集.mp4"],
    );
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

test("uses two real file-chooser batches for 64 episodes when the uploader supports multiple files", {
  timeout: 60_000,
}, async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: cachedChromiumExecutable,
  });
  const page = await browser.newPage();

  try {
    await page.setContent(`
      <div class="proj-catalog-wrap">
        <div class="catalog-upload-video-wrap"><p class="upload-title">上传视频</p></div>
        <div id="episode-list"></div>
      </div>
      <script>${batchFileChooserRecreatingInputFixtureScript()}</script>
    `);

    await uploadIqiyiEpisodeVideos(page, taskWithSixtyFourEpisodes(), {
      localMaterialRoot,
      assetDownloadDir,
      videoUploadTimeoutMinutes: 1,
    });

    const uploadedNames = await page.locator(".catalog-form-text").allInnerTexts();
    assert.equal(uploadedNames.length, 64);
    assert.equal(uploadedNames[0], "输入重建稳定性测试剧-第1集.mp4");
    assert.equal(uploadedNames[63], "输入重建稳定性测试剧-第64集.mp4");
    assert.equal(await page.locator("body").getAttribute("data-selection-count"), "2");
    assert.equal(await page.locator("body").getAttribute("data-maximum-selection-size"), "50");
  } finally {
    await browser.close();
  }
});

test("retries missing episodes when a batch consumes one file and recreates its input", {
  timeout: 60_000,
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
        <div id="episode-list"></div>
      </div>
      <script>${singleFileRecreatingInputFixtureScript()}</script>
    `);

    await uploadIqiyiEpisodeVideos(page, taskWithSixtyFourEpisodes(), {
      localMaterialRoot,
      assetDownloadDir,
      videoUploadTimeoutMinutes: 1,
    });

    const uploadedNames = await page.locator(".catalog-form-text").allInnerTexts();
    assert.equal(uploadedNames.length, 64);
    assert.equal(uploadedNames[0], "输入重建稳定性测试剧-第1集.mp4");
    assert.equal(uploadedNames[63], "输入重建稳定性测试剧-第64集.mp4");
    assert.equal(await page.locator("body").getAttribute("data-selection-count"), "64");
    assert.equal(await page.locator("body").getAttribute("data-maximum-selection-size"), "50");
  } finally {
    await browser.close();
  }
});
