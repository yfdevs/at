import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";
import {
  assertNoDouyinFormError,
  fillDouyinPublishDateTime,
  isTransientDouyinUploadMessage,
  normalizeDouyinPublishDateTime,
  resetRestoredDouyinFormIfPresent,
  selectDropdownValues,
  selectFirstDropdownByPlaceholder,
  selectSearchableDropdownByPlaceholder,
  uploadFormFiles,
} from "../../src/automation/form-controls.js";
import { createDouyinDramaDropdownRecorder } from "../../src/shared/dropdown-options.js";

function launchTestBrowser() {
  const executablePath = fileURLToPath(new URL(
    "../../../../.cache/playwright-browsers/chromium-1228/chrome-win64/chrome.exe",
    import.meta.url,
  ));
  return chromium.launch({ executablePath, headless: true });
}

test("treats the platform upload-in-progress notice as transient", () => {
  assert.equal(isTransientDouyinUploadMessage("资源上传中请等待"), true);
  assert.equal(isTransientDouyinUploadMessage("图片上传中，请等待"), true);
  assert.equal(isTransientDouyinUploadMessage("正在上传成本配置情况"), true);
});

test("does not hide real upload validation errors", () => {
  assert.equal(isTransientDouyinUploadMessage("请上传成本配置情况"), false);
  assert.equal(isTransientDouyinUploadMessage("文件格式错误"), false);
  assert.equal(isTransientDouyinUploadMessage("上传失败"), false);
});

test("normalizes and fills the publish time returned by the task API", async () => {
  assert.equal(
    normalizeDouyinPublishDateTime("2026-09-22T18:30:00+08:00"),
    "2026-09-22 18:30:00",
  );
  assert.throws(
    () => normalizeDouyinPublishDateTime("not-a-date"),
    /DOUYIN_DRAMA_SCHEDULED_PUBLISH_TIME_INVALID/u,
  );

  const browser = await launchTestBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <div id="hong_guo_app_publish_time">
        <input placeholder="请选择（最早支持设置+72小时的发布时间）">
      </div>
      <div id="publish-time-popup" class="arco-picker-container" style="display:none">
        <div class="date-panel">
          <div class="arco-picker-header">
            <button class="arco-picker-header-icon">上一年</button>
            <button class="arco-picker-header-icon">上一月</button>
            <div class="arco-picker-header-value">
              <span class="arco-picker-header-label">2026年</span>
              <span class="arco-picker-header-label">9月</span>
            </div>
            <button class="arco-picker-header-icon">下一月</button>
            <button class="arco-picker-header-icon">下一年</button>
          </div>
          <div class="arco-picker-cell arco-picker-cell-in-view">
            <div class="arco-picker-date"><span>22</span></div>
          </div>
          <button class="arco-picker-btn-select-time" type="button">选择时间</button>
        </div>
        <div class="time-panel" style="display:none">
          <div class="arco-timepicker-list"><ul>
            <li class="arco-timepicker-cell"><span>17</span></li>
            <li class="arco-timepicker-cell"><span>18</span></li>
          </ul></div>
          <div class="arco-timepicker-list"><ul>
            <li class="arco-timepicker-cell"><span>00</span></li>
            <li class="arco-timepicker-cell"><span>30</span></li>
          </ul></div>
          <div class="arco-timepicker-list"><ul>
            <li class="arco-timepicker-cell"><span>00</span></li>
          </ul></div>
        </div>
        <button class="arco-picker-btn-confirm" type="button" disabled>确定</button>
      </div>
      <script>
        const input = document.querySelector('#hong_guo_app_publish_time input');
        const popup = document.querySelector('#publish-time-popup');
        const datePanel = popup.querySelector('.date-panel');
        const timePanel = popup.querySelector('.time-panel');
        const confirm = popup.querySelector('.arco-picker-btn-confirm');
        let selectedDate = false;
        input.addEventListener('click', () => { popup.style.display = 'block'; });
        popup.querySelector('.arco-picker-date').addEventListener('click', () => {
          selectedDate = true;
        });
        popup.querySelector('.arco-picker-btn-select-time').addEventListener('click', () => {
          datePanel.style.display = 'none';
          timePanel.style.display = 'block';
        });
        popup.querySelectorAll('.arco-timepicker-cell').forEach((cell) => {
          cell.addEventListener('click', () => {
            cell.parentElement.querySelectorAll('.arco-timepicker-cell').forEach((other) => {
              other.classList.remove('arco-timepicker-cell-selected');
            });
            cell.classList.add('arco-timepicker-cell-selected');
            const allSelected = [...popup.querySelectorAll('.arco-timepicker-list')]
              .every((list) => list.querySelector('.arco-timepicker-cell-selected'));
            confirm.disabled = !(selectedDate && allSelected);
          });
        });
        confirm.addEventListener('click', () => {
          input.value = '2026-09-22 18:30';
          popup.style.display = 'none';
        });
      </script>
    `);
    assert.equal(
      await fillDouyinPublishDateTime(page, "2026-09-22 18:30"),
      "2026-09-22 18:30:00",
    );
    assert.equal(
      await page.locator("#hong_guo_app_publish_time input").inputValue(),
      "2026-09-22 18:30",
    );
  } finally {
    await browser.close();
  }
});

test("ignores publish-configuration advisory alerts but keeps form validation errors", async () => {
  const browser = await launchTestBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <div class="arco-alert arco-alert-info" role="alert">
        以下全部内容，在漫剧专辑ID生成后将不可修改，请谨慎操作。原生配置操作说明
      </div>
    `);
    await assert.doesNotReject(() => assertNoDouyinFormError(page, "下一步"));

    await page.locator("body").evaluate((body) => {
      const message = document.createElement("div");
      message.className = "arco-form-message";
      message.textContent = "请选择发布账号";
      body.append(message);
    });
    await assert.rejects(
      () => assertNoDouyinFormError(page, "下一步"),
      /DOUYIN_DRAMA_FORM_ERROR: 下一步: 请选择发布账号/u,
    );
  } finally {
    await browser.close();
  }
});

test("resets the form when Douyin restores the previous draft", async () => {
  const browser = await launchTestBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <input id="book_name_input" value="上次填写的剧名">
      <div class="arco-upload-list"><div class="arco-upload-list-item">旧附件.png</div></div>
      <div class="arco-message arco-message-success" role="alert">
        <span>已同步上次填写内容</span>
        <button type="button" id="reset">点此重置为空</button>
      </div>
      <script>
        document.querySelector('#reset').addEventListener('click', () => {
          document.querySelector('#book_name_input').value = '';
          document.querySelector('.arco-upload-list').replaceChildren();
          document.querySelector('.arco-message').remove();
        });
      </script>
    `);

    assert.equal(await resetRestoredDouyinFormIfPresent(page, 1_000), true);
    assert.equal(await page.locator("#book_name_input").inputValue(), "");
    assert.equal(await page.locator(".arco-upload-list-item").count(), 0);
  } finally {
    await browser.close();
  }
});

test("confirms selections from control state and closes persistent dropdown popups", async () => {
  const browser = await launchTestBrowser();
  const page = await browser.newPage();
  const recorder = createDouyinDramaDropdownRecorder({});
  try {
    await page.setContent(`
      <div class="arco-form-item">
        <label>关联AIGC工具</label>
        <div id="aigc" role="combobox" class="arco-select" style="width:240px;height:32px"><span class="value">请选择</span></div>
      </div>
      <div id="aigc-popup" class="arco-select-popup" role="listbox">
        <div role="option" class="arco-select-option">红果漫剧创作Agent</div>
      </div>
      <div id="contract" role="combobox" class="arco-select" style="width:320px;height:32px">
        <input placeholder="请选择合同" value=""><span class="value"></span>
      </div>
      <div id="contract-popup" class="arco-select-popup" role="listbox" style="display:none">
        <div role="option" class="arco-select-option">CT20260521191189 【明星说】漫剧合作协议（框架）</div>
      </div>
      <script>
        const setup = (triggerId, popupId, shortenedValue) => {
          const trigger = document.querySelector(triggerId);
          const popup = document.querySelector(popupId);
          trigger.addEventListener('click', () => { popup.style.display = 'block'; });
          popup.querySelector('[role=option]').addEventListener('click', (event) => {
            event.currentTarget.setAttribute('aria-selected', 'true');
            event.currentTarget.classList.add('arco-select-option-selected');
            trigger.querySelector('.value').textContent = shortenedValue;
          });
          document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') popup.style.display = 'none';
          });
        };
        setup('#aigc', '#aigc-popup', '红果漫剧创作Agent');
        setup('#contract', '#contract-popup', 'CT20260521191189');
      </script>
    `);

    await selectDropdownValues(page, "关联AIGC工具", ["红果漫剧创作Agent"], recorder);
    assert.equal(await page.locator("#aigc-popup").isVisible(), false);
    const selected = await selectFirstDropdownByPlaceholder(
      page,
      "请选择合同",
      "contract",
      recorder,
    );
    assert.match(selected, /^CT20260521191189/u);
    assert.equal(await page.locator("#contract-popup").isVisible(), false);
  } finally {
    await browser.close();
  }
});

test("selects the publish account name returned by the task API", async () => {
  const browser = await launchTestBrowser();
  const page = await browser.newPage();
  const recorder = createDouyinDramaDropdownRecorder({});
  try {
    await page.setContent(`
      <div id="publish-account" role="combobox" class="arco-select" style="width:320px;height:32px">
        <input placeholder="请选择发布账号" value=""><span class="value"></span>
      </div>
      <div id="publish-account-popup" class="arco-select-popup" role="listbox" style="display:none">
        <div role="option" class="arco-select-option">兜兜动漫 B号 每日限额2000</div>
        <div role="option" class="arco-select-option">其他发布账号</div>
      </div>
      <script>
        const trigger = document.querySelector('#publish-account');
        const input = trigger.querySelector('input');
        const popup = document.querySelector('#publish-account-popup');
        trigger.addEventListener('click', () => { popup.style.display = 'block'; });
        input.addEventListener('input', () => { popup.style.display = 'block'; });
        popup.querySelectorAll('[role=option]').forEach((option) => {
          option.addEventListener('click', (event) => {
            event.currentTarget.setAttribute('aria-selected', 'true');
            event.currentTarget.classList.add('arco-select-option-selected');
            trigger.querySelector('.value').textContent = event.currentTarget.textContent;
          });
        });
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') popup.style.display = 'none';
        });
      </script>
    `);

    await selectSearchableDropdownByPlaceholder(
      page,
      "请选择发布账号",
      "publishAccount",
      "兜兜动漫",
      recorder,
    );
    assert.match(
      await page.locator("#publish-account .value").innerText(),
      /^兜兜动漫/u,
    );
    assert.equal(await page.locator("#publish-account-popup").isVisible(), false);
  } finally {
    await browser.close();
  }
});

test("uses the chooser opened by copyright drag uploaders", async () => {
  const browser = await launchTestBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <div role="alert" class="arco-message">资源上传中请等待</div>
      <div class="arco-form-item">
        <label>权属文件</label>
        <div id="copyright_files_input" class="arco-upload">
          <input id="unused-outer-input" type="file" style="display: none">
          <section class="file-picker-box">
            <input id="active-picker-input" type="file" style="display: none">
            <span>点击或拖拽文件到此上传</span>
          </section>
        </div>
        <div class="arco-upload-list"></div>
      </div>
      <script>
        document.querySelector('.file-picker-box').addEventListener('click', () => {
          document.querySelector('#active-picker-input').click();
        });
        document.querySelector('#active-picker-input').addEventListener('change', (event) => {
          const list = document.querySelector('.arco-form-item');
          for (const file of event.currentTarget.files) {
            const item = document.createElement('div');
            item.className = 'uploaded_list_item';
            item.innerHTML = \`<div class="file-name">\${file.name}</div>
              <div class="file-status-text file-status-text-success">上传完成</div>\`;
            list.append(item);
          }
        });
      </script>
    `);

    await uploadFormFiles(
      page,
      "权属文件",
      [fileURLToPath(import.meta.url)],
      5_000,
      "copyright_files_input",
    );
    assert.equal(await page.locator("#active-picker-input").evaluate((input: HTMLInputElement) =>
      input.files?.length), 1);
    assert.equal(await page.locator("#unused-outer-input").evaluate((input: HTMLInputElement) =>
      input.files?.length), 0);
    assert.equal(await page.locator(".uploaded_list_item").count(), 1);
    assert.equal(await page.locator(".file-status-text-success").innerText(), "上传完成");
  } finally {
    await browser.close();
  }
});

test("deletes and retries only a cloud image stuck at upload 100 percent", async () => {
  const browser = await launchTestBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <div class="arco-form-item">
        <label>工程文件截图</label>
        <div id="engineering_file_screenshots_input" class="arco-upload">
          <section class="file-picker-box">
            <input id="project-picker-input" type="file" multiple style="display: none">
            <span>点击或拖拽文件到此上传</span>
          </section>
        </div>
        <div class="arco-upload-list"></div>
      </div>
      <div role="dialog" class="arco-modal global-confirm-modal" style="display:none">
        <div>删除图片</div>
        <div>删除图片后不可恢复，是否要删除该图片？</div>
        <button type="button">取消</button>
        <button id="confirm-delete" type="button">确定</button>
      </div>
      <script>
        window.uploadChangeCount = 0;
        window.deleteConfirmCount = 0;
        let pendingDelete;
        const picker = document.querySelector('#project-picker-input');
        const formItem = document.querySelector('.arco-form-item');
        const dialog = document.querySelector('[role=dialog]');
        document.querySelector('.file-picker-box').addEventListener('click', () => picker.click());
        picker.addEventListener('change', (event) => {
          window.uploadChangeCount += 1;
          [...event.currentTarget.files].forEach((file, index) => {
            const stalled = window.uploadChangeCount === 1 && index === 0;
            const item = document.createElement('div');
            item.className = 'uploaded_list_item';
            item.innerHTML = \`<div class="file-name">\${file.name}</div>
              <div class="file-status-text \${stalled ? '' : 'file-status-text-success'}">
                \${stalled ? '上传中 100%' : '上传完成'}
              </div>
              <div class="uploaded_list_item-ops"><button type="button">
                <svg class="serial-icon-general_delete"></svg>
              </button></div>\`;
            item.querySelector('button').addEventListener('click', () => {
              pendingDelete = item;
              dialog.style.display = 'block';
            });
            formItem.append(item);
          });
          event.currentTarget.value = '';
        });
        document.querySelector('#confirm-delete').addEventListener('click', () => {
          window.deleteConfirmCount += 1;
          pendingDelete.remove();
          pendingDelete = undefined;
          dialog.style.display = 'none';
        });
      </script>
    `);

    const fixture = fileURLToPath(import.meta.url);
    await uploadFormFiles(
      page,
      "工程文件截图",
      [fixture, fixture, fixture, fixture],
      5_000,
      "engineering_file_screenshots_input",
    );

    assert.equal(await page.evaluate(() => (window as any).uploadChangeCount), 2);
    assert.equal(await page.evaluate(() => (window as any).deleteConfirmCount), 1);
    assert.equal(await page.locator(".uploaded_list_item").count(), 4);
    assert.equal(await page.locator(".file-status-text-success").count(), 4);
  } finally {
    await browser.close();
  }
});

test("fails after five retries when a cloud image stays at upload 100 percent", async () => {
  const browser = await launchTestBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <div class="arco-form-item">
        <label>工程文件截图</label>
        <div id="engineering_file_screenshots_input" class="arco-upload">
          <section class="file-picker-box">
            <input id="project-picker-input" type="file" style="display: none">
            <span>点击或拖拽文件到此上传</span>
          </section>
        </div>
        <div class="arco-upload-list"></div>
      </div>
      <div role="dialog" class="arco-modal global-confirm-modal" style="display:none">
        <div>删除图片</div><div>删除图片后不可恢复，是否要删除该图片？</div>
        <button id="confirm-delete" type="button">确定</button>
      </div>
      <script>
        window.uploadChangeCount = 0;
        let pendingDelete;
        const picker = document.querySelector('#project-picker-input');
        const formItem = document.querySelector('.arco-form-item');
        const dialog = document.querySelector('[role=dialog]');
        document.querySelector('.file-picker-box').addEventListener('click', () => picker.click());
        picker.addEventListener('change', (event) => {
          window.uploadChangeCount += 1;
          const file = event.currentTarget.files[0];
          const item = document.createElement('div');
          item.className = 'uploaded_list_item';
          item.innerHTML = \`<div class="file-name">\${file.name}</div>
            <div class="file-status-text">上传中 100%</div>
            <div class="uploaded_list_item-ops"><button type="button">
              <svg class="serial-icon-general_delete"></svg>
            </button></div>\`;
          item.querySelector('button').addEventListener('click', () => {
            pendingDelete = item;
            dialog.style.display = 'block';
          });
          formItem.append(item);
          event.currentTarget.value = '';
        });
        document.querySelector('#confirm-delete').addEventListener('click', () => {
          pendingDelete.remove();
          pendingDelete = undefined;
          dialog.style.display = 'none';
        });
      </script>
    `);

    await assert.rejects(
      () => uploadFormFiles(
        page,
        "工程文件截图",
        [fileURLToPath(import.meta.url)],
        3_000,
        "engineering_file_screenshots_input",
      ),
      /DOUYIN_DRAMA_UPLOAD_NOT_CONFIRMED: 工程文件截图; stalledAt100Retries=5/u,
    );
    assert.equal(await page.evaluate(() => (window as any).uploadChangeCount), 6);
  } finally {
    await browser.close();
  }
});
