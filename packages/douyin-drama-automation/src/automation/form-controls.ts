import type { Locator, Page } from "playwright";
import { DOUYIN_DRAMA_SERIES_TYPE } from "../shared/constants.js";
import type { DouyinDramaDropdownRecorder } from "../shared/dropdown-options.js";
import type { DouyinDramaRole } from "../shared/types.js";

function exactTextPattern(value: string) {
  return new RegExp(`^\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
}

export function douyinFormItem(page: Page, label: string) {
  return page
    .locator(".arco-form-item:visible")
    .filter({ has: page.getByText(label, { exact: true }) })
    .first();
}

export async function fillInputById(page: Page, id: string, value?: string | number) {
  if (value === undefined) return;
  const input = page.locator(`#${id}`).first();
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await input.fill(String(value));
}

export async function fillStableInputById(
  page: Page,
  id: string,
  value: string | number,
  timeoutMs = 30_000,
) {
  const expected = String(value);
  const input = page.locator(`#${id}`).first();
  await input.waitFor({ state: "visible", timeout: 10_000 });
  const deadline = Date.now() + timeoutMs;
  let stablePasses = 0;
  while (Date.now() < deadline) {
    if (!await input.isEnabled().catch(() => false)) {
      stablePasses = 0;
      await page.waitForTimeout(500);
      continue;
    }
    if (await input.inputValue() !== expected) await input.fill(expected);
    await page.waitForTimeout(500);
    if (await input.inputValue() === expected) stablePasses += 1;
    else stablePasses = 0;
    // Keep the fixed value stable long enough for delayed OCR updates to finish.
    if (stablePasses >= 6) return;
  }
  throw new Error(
    `DOUYIN_DRAMA_INPUT_VALUE_NOT_STABLE: #${id} expected=${expected} ` +
      `actual=${await input.inputValue().catch(() => "")}`,
  );
}

export function normalizeDouyinPublishDateTime(value: string) {
  const trimmed = value.trim();
  const localParts = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/u,
  );
  if (localParts) {
    return `${localParts[1]}-${localParts[2]}-${localParts[3]} ` +
      `${localParts[4]}:${localParts[5]}:${localParts[6] ?? "00"}`;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`DOUYIN_DRAMA_SCHEDULED_PUBLISH_TIME_INVALID: ${JSON.stringify(value)}`);
  }
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(parsed).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function douyinPublishDateTimeParts(value: string) {
  const matched = value.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/u,
  );
  if (!matched) throw new Error(`DOUYIN_DRAMA_SCHEDULED_PUBLISH_TIME_INVALID: ${JSON.stringify(value)}`);
  return {
    day: Number(matched[3]),
    hour: matched[4],
    minute: matched[5],
    month: Number(matched[2]),
    second: matched[6],
    year: Number(matched[1]),
  };
}

function arcoDatePickerPopup(page: Page) {
  return page
    .locator(".arco-picker-container:visible:not(.arco-picker-panel-only)")
    .last();
}

async function readArcoPickerYearMonth(popup: Locator) {
  const labels = (await popup.locator(".arco-picker-header-label").allTextContents())
    .map((text) => text.replace(/\s+/g, "").trim());
  const year = Number(labels.find((text) => /年$/u.test(text))?.replace(/\D/gu, ""));
  const month = Number(labels.find((text) => /月$/u.test(text))?.replace(/\D/gu, ""));
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month) || month < 1 || month > 12) {
    throw new Error(
      `DOUYIN_DRAMA_SCHEDULED_PUBLISH_CALENDAR_HEADER_INVALID: ${JSON.stringify(labels)}`,
    );
  }
  return { month, year };
}

async function selectArcoPublishDate(
  page: Page,
  popup: Locator,
  target: ReturnType<typeof douyinPublishDateTimeParts>,
) {
  const selectDateButton = popup.locator(".arco-picker-btn-select-date:visible").first();
  if (await selectDateButton.count()) await selectDateButton.click();

  for (let navigationCount = 0; navigationCount < 120; navigationCount += 1) {
    const current = await readArcoPickerYearMonth(popup);
    const monthDelta = (target.year - current.year) * 12 + target.month - current.month;
    if (monthDelta === 0) break;
    const headerIcons = popup.locator(".arco-picker-header > .arco-picker-header-icon:visible");
    if (await headerIcons.count() < 4) {
      throw new Error("DOUYIN_DRAMA_SCHEDULED_PUBLISH_CALENDAR_NAVIGATION_NOT_FOUND");
    }
    // Arco header order: previous year, previous month, next month, next year.
    await headerIcons.nth(monthDelta > 0 ? 2 : 1).click();
    await page.waitForTimeout(80);
  }

  const current = await readArcoPickerYearMonth(popup);
  if (current.year !== target.year || current.month !== target.month) {
    throw new Error(
      `DOUYIN_DRAMA_SCHEDULED_PUBLISH_CALENDAR_NAVIGATION_FAILED: `
        + `expected=${target.year}-${String(target.month).padStart(2, "0")}; `
        + `actual=${current.year}-${String(current.month).padStart(2, "0")}`,
    );
  }

  const dateCell = popup
    .locator(".arco-picker-cell-in-view:visible")
    .filter({ hasText: exactTextPattern(String(target.day)) })
    .first();
  await dateCell.waitFor({ state: "visible", timeout: 5_000 });
  const cellClass = await dateCell.getAttribute("class") ?? "";
  if (/arco-picker-cell-disabled/u.test(cellClass)) {
    throw new Error(
      `DOUYIN_DRAMA_SCHEDULED_PUBLISH_DATE_DISABLED: `
        + `${target.year}-${String(target.month).padStart(2, "0")}-${String(target.day).padStart(2, "0")}`,
    );
  }
  await dateCell.locator(".arco-picker-date").click();
}

async function selectArcoPublishTime(
  popup: Locator,
  target: ReturnType<typeof douyinPublishDateTimeParts>,
) {
  const selectTimeButton = popup.locator(".arco-picker-btn-select-time:visible").first();
  await selectTimeButton.waitFor({ state: "visible", timeout: 5_000 });
  await selectTimeButton.click();

  const lists = popup.locator(".arco-timepicker-list:visible");
  const listCount = await lists.count();
  if (listCount < 2) {
    throw new Error(`DOUYIN_DRAMA_SCHEDULED_PUBLISH_TIME_PANEL_INVALID: columns=${listCount}`);
  }
  const values = [target.hour, target.minute, target.second];
  for (let index = 0; index < Math.min(listCount, values.length); index += 1) {
    const cell = lists
      .nth(index)
      .locator(".arco-timepicker-cell:visible")
      .filter({ hasText: exactTextPattern(values[index]) })
      .first();
    await cell.waitFor({ state: "visible", timeout: 5_000 });
    const cellClass = await cell.getAttribute("class") ?? "";
    if (/arco-timepicker-cell-disabled/u.test(cellClass)) {
      throw new Error(
        `DOUYIN_DRAMA_SCHEDULED_PUBLISH_TIME_DISABLED: column=${index}; value=${values[index]}`,
      );
    }
    await cell.click();
  }
}

export async function fillDouyinPublishDateTime(page: Page, value: string) {
  const expected = normalizeDouyinPublishDateTime(value);
  const target = douyinPublishDateTimeParts(expected);
  const input = page.locator("#hong_guo_app_publish_time input").first();
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await input.click();
  const popup = arcoDatePickerPopup(page);
  await popup.waitFor({ state: "visible", timeout: 5_000 });
  await selectArcoPublishDate(page, popup, target);
  await selectArcoPublishTime(popup, target);

  const confirm = popup.locator(".arco-picker-btn-confirm:visible").first();
  await confirm.waitFor({ state: "visible", timeout: 5_000 });
  const confirmDeadline = Date.now() + 5_000;
  while (!await confirm.isEnabled().catch(() => false) && Date.now() < confirmDeadline) {
    await page.waitForTimeout(100);
  }
  if (!await confirm.isEnabled().catch(() => false)) {
    throw new Error("DOUYIN_DRAMA_SCHEDULED_PUBLISH_CONFIRM_DISABLED");
  }
  await confirm.click();
  await popup.waitFor({ state: "hidden", timeout: 5_000 });

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const actual = (await input.inputValue()).trim();
    // The shortdramas page currently formats this Arco DatePicker only to the
    // minute even though the task contract carries seconds. A missing ":00"
    // is therefore the same confirmed time, not a failed selection.
    const minutePrecisionExpected = expected.endsWith(":00") ? expected.slice(0, -3) : undefined;
    if (actual === expected || actual === minutePrecisionExpected) return expected;
    await page.waitForTimeout(200);
  }
  throw new Error(
    `DOUYIN_DRAMA_SCHEDULED_PUBLISH_TIME_NOT_CONFIRMED: expected=${expected}; ` +
      `actual=${JSON.stringify(await input.inputValue().catch(() => ""))}`,
  );
}

export async function fillFormItem(page: Page, label: string, value?: string | number) {
  if (value === undefined) return;
  const input = douyinFormItem(page, label).locator("input, textarea").first();
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await input.fill(String(value));
}

async function restoredFormSnapshot(page: Page) {
  const title = await page.locator("#book_name_input").first().inputValue().catch(() => "");
  const uploadedFileCount = await page.locator(".arco-upload-list-item:visible").count();
  return { title: title.trim(), uploadedFileCount };
}

export async function resetRestoredDouyinFormIfPresent(page: Page, timeoutMs = 8_000) {
  const restoredMessage = page
    .locator(".arco-message:visible, [role='alert']:visible")
    .filter({ hasText: "已同步上次填写内容" })
    .first();
  const appeared = await restoredMessage.waitFor({ state: "visible", timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
  if (!appeared) {
    const snapshot = await restoredFormSnapshot(page);
    if (snapshot.title || snapshot.uploadedFileCount > 0) {
      throw new Error(
        `DOUYIN_DRAMA_STALE_FORM_RESET_REQUIRED: 页面存在上次填写内容但未找到重置按钮；` +
          `title=${JSON.stringify(snapshot.title)} uploads=${snapshot.uploadedFileCount}`,
      );
    }
    return false;
  }

  const resetButton = restoredMessage
    .getByRole("button", { name: "点此重置为空", exact: true })
    .first();
  await resetButton.waitFor({ state: "visible", timeout: 5_000 });
  await resetButton.click();

  const confirmDialog = page
    .locator("[role='dialog']:visible, .arco-modal:visible")
    .filter({ hasText: /重置|清空/ })
    .last();
  const needsConfirmation = await confirmDialog.waitFor({ state: "visible", timeout: 1_500 })
    .then(() => true)
    .catch(() => false);
  if (needsConfirmation) {
    const confirmButton = confirmDialog
      .getByRole("button", { name: /确定|确认|继续/ })
      .filter({ visible: true })
      .last();
    await confirmButton.waitFor({ state: "visible", timeout: 5_000 });
    await confirmButton.click();
    await confirmDialog.waitFor({ state: "hidden", timeout: 15_000 });
  }

  const deadline = Date.now() + 30_000;
  let blankPasses = 0;
  while (Date.now() < deadline) {
    const snapshot = await restoredFormSnapshot(page);
    const noticeHidden = !await restoredMessage.isVisible().catch(() => false);
    if (!snapshot.title && snapshot.uploadedFileCount === 0 && noticeHidden) blankPasses += 1;
    else blankPasses = 0;
    if (blankPasses >= 3) return true;
    await page.waitForTimeout(500);
  }
  const snapshot = await restoredFormSnapshot(page);
  throw new Error(
    `DOUYIN_DRAMA_STALE_FORM_RESET_NOT_CONFIRMED: ` +
      `title=${JSON.stringify(snapshot.title)} uploads=${snapshot.uploadedFileCount}`,
  );
}

export async function selectRadio(page: Page, label: string, value: string) {
  const item = douyinFormItem(page, label);
  const text = item.getByText(value, { exact: true }).filter({ visible: true }).first();
  await text.waitFor({ state: "visible", timeout: 10_000 });
  const labelRoot = text.locator("xpath=ancestor::label[1]");
  const radioRoot = text.locator("xpath=ancestor::*[contains(@class, 'radio')][1]");
  const input = (await labelRoot.count())
    ? labelRoot.locator('input[type="radio"]').first()
    : radioRoot.locator('input[type="radio"]').first();
  if ((await input.count()) && await input.isChecked().catch(() => false)) return;
  await text.click();
  if ((await input.count()) && !(await input.isChecked().catch(() => false))) {
    await input.check({ force: true });
  }
  if ((await input.count()) && !(await input.isChecked().catch(() => false))) {
    throw new Error(`DOUYIN_DRAMA_RADIO_NOT_SELECTED: ${label}=${value}`);
  }
}

export async function selectVisibleRadio(page: Page, value: string) {
  const text = page.getByText(value, { exact: true }).filter({ visible: true }).last();
  await text.waitFor({ state: "visible", timeout: 10_000 });
  await text.click();
}

function dropdownOptions(page: Page) {
  return page.locator([
    ".arco-select-popup:visible [role='option']",
    ".arco-select-popup:visible .arco-select-option",
    ".arco-select-dropdown:visible [role='option']",
    ".arco-select-dropdown:visible .arco-select-option",
    "[role='listbox']:visible [role='option']",
  ].join(", "));
}

function visibleDropdownSurfaces(page: Page) {
  return page.locator([
    ".arco-select-popup:visible",
    ".arco-select-dropdown:visible",
    "[role='listbox']:visible",
  ].join(", "));
}

async function closeVisibleDropdowns(page: Page, field: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await visibleDropdownSurfaces(page).count() === 0) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }
  throw new Error(`DOUYIN_DRAMA_DROPDOWN_NOT_CLOSED: ${field}`);
}

function compactDropdownText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

async function confirmDropdownSelection(
  page: Page,
  trigger: Locator,
  option: Locator,
  field: string,
  value: string,
) {
  const expected = compactDropdownText(value);
  const stableToken = expected.split(" ")[0] ?? expected;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const triggerText = compactDropdownText(await trigger.textContent().catch(() => ""));
    const inputValues = await trigger.locator("input").evaluateAll((inputs) =>
      inputs.map((input) => (input as HTMLInputElement).value).filter(Boolean)
    ).catch(() => [] as string[]);
    const optionState = [
      await option.getAttribute("aria-selected").catch(() => null),
      await option.getAttribute("aria-checked").catch(() => null),
      await option.getAttribute("class").catch(() => null),
    ].join(" ");
    const optionInputSelected = await option.locator('input[type="checkbox"], input[type="radio"]')
      .first()
      .isChecked()
      .catch(() => false);
    if (
      triggerText.includes(expected) ||
      (stableToken.length >= 2 && triggerText.includes(stableToken)) ||
      inputValues.some((inputValue) => compactDropdownText(inputValue).includes(stableToken)) ||
      /\btrue\b|option-selected|option-checked/.test(optionState) ||
      optionInputSelected
    ) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`DOUYIN_DRAMA_DROPDOWN_SELECTION_NOT_CONFIRMED: ${field}=${value}`);
}

async function openDropdown(page: Page, trigger: Locator) {
  await closeVisibleDropdowns(page, "打开下拉前清理残留弹层");
  await trigger.waitFor({ state: "visible", timeout: 10_000 });
  await trigger.click();
  const options = dropdownOptions(page);
  await options.first().waitFor({ state: "visible", timeout: 10_000 });
  return options;
}

async function observedOptions(options: Locator) {
  return [...new Set(
    (await options.allTextContents())
      .map((text) => text.replace(/\s+/g, " ").trim())
      .filter(Boolean),
  )];
}

async function selectDropdownValuesFromTrigger(
  page: Page,
  trigger: Locator,
  field: string,
  values: string[],
  recorder: DouyinDramaDropdownRecorder,
) {
  for (const value of values) {
    const currentText = (await trigger.textContent().catch(() => "")) ?? "";
    if (compactDropdownText(currentText).includes(compactDropdownText(value))) {
      await closeVisibleDropdowns(page, field);
      continue;
    }
    const options = await openDropdown(page, trigger);
    const observed = await observedOptions(options);
    await recorder.record(field, observed);
    const option = options
      .filter({ hasText: exactTextPattern(value), visible: true })
      .first();
    await option.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {
      throw new Error(
        `DOUYIN_DRAMA_DROPDOWN_OPTION_NOT_FOUND: ${field}=${value}; ` +
          `observed=${JSON.stringify(observed)}`,
      );
    });
    await option.click();
    await confirmDropdownSelection(page, trigger, option, field, value);
    await closeVisibleDropdowns(page, field);
  }
}

export async function selectDropdownValues(
  page: Page,
  label: string,
  values: string[],
  recorder: DouyinDramaDropdownRecorder,
) {
  if (values.length === 0) return;
  const item = douyinFormItem(page, label);
  const trigger = item.locator("[role='combobox'], .arco-select").first();
  await selectDropdownValuesFromTrigger(page, trigger, label, values, recorder);
}

export async function selectDropdownByPlaceholder(
  page: Page,
  placeholder: string,
  field: string,
  value: string,
  recorder: DouyinDramaDropdownRecorder,
) {
  const input = page.getByPlaceholder(placeholder, { exact: true }).filter({ visible: true }).first();
  const selectRoot = input.locator(
    "xpath=ancestor::*[@role='combobox' or contains(@class, 'arco-select')][1]",
  );
  const trigger = (await selectRoot.count()) ? selectRoot : input;
  await selectDropdownValuesFromTrigger(page, trigger, field, [value], recorder);
}

export async function selectSearchableDropdownByPlaceholder(
  page: Page,
  placeholder: string,
  field: string,
  value: string,
  recorder: DouyinDramaDropdownRecorder,
) {
  const input = page.getByPlaceholder(placeholder, { exact: true }).filter({ visible: true }).first();
  await closeVisibleDropdowns(page, field);
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await input.click();
  await input.fill(value);
  const options = dropdownOptions(page);
  await options.first().waitFor({ state: "visible", timeout: 10_000 });
  const observed = await observedOptions(options);
  await recorder.record(field, observed);
  const expected = compactDropdownText(value);
  const matchedOptionText = observed.find((candidate) => compactDropdownText(candidate) === expected)
    ?? observed.find((candidate) => compactDropdownText(candidate).includes(expected));
  if (!matchedOptionText) {
    throw new Error(
      `DOUYIN_DRAMA_DROPDOWN_OPTION_NOT_FOUND: ${field}=${value}; ` +
        `observed=${JSON.stringify(observed)}`,
    );
  }
  const option = options.filter({
    hasText: exactTextPattern(matchedOptionText),
    visible: true,
  }).first();
  await option.waitFor({ state: "visible", timeout: 10_000 });
  await option.click();
  const selectRoot = input.locator(
    "xpath=ancestor::*[@role='combobox' or contains(@class, 'arco-select')][1]",
  );
  const trigger = await selectRoot.count() ? selectRoot : input;
  await confirmDropdownSelection(page, trigger, option, field, value);
  await closeVisibleDropdowns(page, field);
}

export async function selectFirstDropdownByPlaceholder(
  page: Page,
  placeholder: string,
  field: string,
  recorder: DouyinDramaDropdownRecorder,
) {
  const input = page.getByPlaceholder(placeholder, { exact: true }).filter({ visible: true }).first();
  const selectRoot = input.locator(
    "xpath=ancestor::*[@role='combobox' or contains(@class, 'arco-select')][1]",
  );
  const trigger = (await selectRoot.count()) ? selectRoot : input;
  const options = await openDropdown(page, trigger);
  const observed = await observedOptions(options);
  await recorder.record(field, observed);
  const selected = observed.find((value) => !/请选择|暂无|无数据/.test(value));
  if (!selected) {
    throw new Error(`DOUYIN_DRAMA_DROPDOWN_EMPTY: ${field}; observed=${JSON.stringify(observed)}`);
  }
  const option = options.filter({ hasText: exactTextPattern(selected), visible: true }).first();
  await option.click();
  await confirmDropdownSelection(page, trigger, option, field, selected);
  await closeVisibleDropdowns(page, field);
  return selected;
}

async function waitForUploadSettlement(
  page: Page,
  item: Locator,
  label: string,
  timeoutMs = 120_000,
  expectedFileCount = 1,
) {
  const deadline = Date.now() + timeoutMs;
  const stalledAt100TimeoutMs = Math.min(15_000, Math.max(750, Math.floor(timeoutMs / 4)));
  let stablePasses = 0;
  let stalledAt100Since = 0;
  let stalledAt100Signature = "";
  let lastObservedFileNames: string[] = [];
  let lastObservedStatuses: string[] = [];
  let lastObservedFileCount = 0;
  let lastCompletedFileCount = 0;
  while (Date.now() < deadline) {
    await assertNoDouyinFormError(page, `上传${label}`);
    const transientUploadMessages = page.locator([
      ".arco-form-message:visible",
      ".arco-message:visible",
      "[role='alert']:visible",
    ].join(", ")).filter({ hasText: /资源上传中请等待|上传中.*请等待|正在上传/ });
    const uploadLists = item.locator(".arco-upload-list");
    const cloudUploadItems = item.locator(".uploaded_list_item");
    const [
      itemText,
      transientMessageCount,
      localBusyCount,
      uploadListCount,
      cloudUploadItemCount,
      cloudCompletedCount,
      arcoUploadItemCount,
      observedFileNames,
      observedStatuses,
    ] = await Promise.all([
      item.innerText().catch(() => ""),
      transientUploadMessages.count(),
      item.locator(
        "[role='progressbar'], .arco-progress, .arco-upload-list-item-uploading, [class*='uploading']",
      ).count(),
      uploadLists.count(),
      cloudUploadItems.count(),
      item.locator(".uploaded_list_item:has(.file-status-text-success)").count(),
      item.locator(".arco-upload-list-item").count(),
      item.locator(".uploaded_list_item .file-name").allTextContents(),
      item.locator(".uploaded_list_item .file-status-text").allTextContents(),
    ]);
    const text = itemText.replace(/\s+/g, " ").trim();
    lastObservedFileNames = observedFileNames.map((value) => value.trim()).filter(Boolean);
    lastObservedStatuses = observedStatuses
      .map((value) => value.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    lastObservedFileCount = cloudUploadItemCount || arcoUploadItemCount;
    lastCompletedFileCount = cloudUploadItemCount > 0
      ? cloudCompletedCount
      : arcoUploadItemCount;
    const stalledAt100Indices = lastObservedStatuses
      .map((status, index) => (/上传中\s*100\s*%/u.test(status) ? index : -1))
      .filter((index) => index >= 0);
    const stalledAt100CompleteSet = cloudUploadItemCount >= expectedFileCount
      && cloudCompletedCount + stalledAt100Indices.length >= expectedFileCount
      && stalledAt100Indices.length > 0;
    if (stalledAt100CompleteSet) {
      const signature = stalledAt100Indices.join(",");
      if (signature !== stalledAt100Signature) {
        stalledAt100Signature = signature;
        stalledAt100Since = Date.now();
      } else if (Date.now() - stalledAt100Since >= stalledAt100TimeoutMs) {
        throw new DouyinUploadStalledAt100Error({
          completedFileCount: cloudCompletedCount,
          expectedFileCount,
          fileNames: lastObservedFileNames,
          label,
          stalledIndices: stalledAt100Indices,
          statuses: lastObservedStatuses,
        });
      }
    } else {
      stalledAt100Signature = "";
      stalledAt100Since = 0;
    }
    const explicitSuccess = lastCompletedFileCount >= expectedFileCount;
    const localBusy = /上传中|处理中|等待上传|解析中|进度/.test(text) || localBusyCount > 0;
    // Arco's global toast can outlive the upload that created it. Once this
    // field shows the expected successful file count, that stale toast must
    // not keep every following upload waiting for seconds (or until timeout).
    const busy = localBusy || (!explicitSuccess && transientMessageCount > 0);
    const uploadResultVisible = uploadListCount === 0 ||
      lastCompletedFileCount >= expectedFileCount;
    if (!busy && uploadResultVisible) stablePasses += 1;
    else stablePasses = 0;
    if (stablePasses >= 2) return;
    await page.waitForTimeout(250);
  }
  throw new Error(
    `DOUYIN_DRAMA_UPLOAD_NOT_CONFIRMED: ${label}; expected=${expectedFileCount}; ` +
      `actual=${lastObservedFileCount}; completed=${lastCompletedFileCount}; ` +
      `files=${JSON.stringify(lastObservedFileNames)}; statuses=${JSON.stringify(lastObservedStatuses)}`,
  );
}

class DouyinUploadStalledAt100Error extends Error {
  readonly stalledIndices: number[];

  constructor(details: {
    completedFileCount: number;
    expectedFileCount: number;
    fileNames: string[];
    label: string;
    stalledIndices: number[];
    statuses: string[];
  }) {
    super(
      `DOUYIN_DRAMA_UPLOAD_STALLED_AT_100: ${details.label}; expected=${details.expectedFileCount}; `
        + `completed=${details.completedFileCount}; stalled=${JSON.stringify(details.stalledIndices)}; `
        + `files=${JSON.stringify(details.fileNames)}; statuses=${JSON.stringify(details.statuses)}`,
    );
    this.name = "DouyinUploadStalledAt100Error";
    this.stalledIndices = details.stalledIndices;
  }
}

async function chooseCloudUploadFiles(
  page: Page,
  control: Locator,
  label: string,
  files: string[],
  timeoutMs: number,
) {
  const trigger = control.locator(".file-picker-box:visible").first();
  await trigger.waitFor({ state: "visible", timeout: 10_000 });
  const chooserTimeoutMs = Math.min(timeoutMs, 15_000);
  const fileChooser = await Promise.all([
    page.waitForEvent("filechooser", { timeout: chooserTimeoutMs }),
    trigger.click({ timeout: chooserTimeoutMs }),
  ]).then(([chooser]) => chooser).catch((error: unknown) => {
    throw new Error(
      `DOUYIN_DRAMA_FILE_CHOOSER_NOT_OPENED: ${label}; ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  await fileChooser.setFiles(files, { timeout: timeoutMs });
}

async function deleteStalledCloudUploadItems(
  page: Page,
  item: Locator,
  label: string,
  stalledIndices: number[],
) {
  for (const index of [...stalledIndices].sort((left, right) => right - left)) {
    const beforeCount = await item.locator(".uploaded_list_item").count();
    const uploadItem = item.locator(".uploaded_list_item").nth(index);
    const deleteButton = uploadItem
      .locator("button:has(.serial-icon-general_delete), .uploaded_list_item-ops button")
      .filter({ visible: true })
      .first();
    await deleteButton.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {
      throw new Error(`DOUYIN_DRAMA_UPLOAD_STALLED_DELETE_NOT_FOUND: ${label}; index=${index}`);
    });
    await deleteButton.click();
    const dialog = page
      .locator("[role='dialog']:visible, .arco-modal:visible")
      .filter({ hasText: /删除图片后不可恢复|删除图片/u })
      .last();
    await dialog.waitFor({ state: "visible", timeout: 10_000 });
    const confirm = dialog.getByRole("button", { name: "确定", exact: true }).last();
    await confirm.click();
    await dialog.waitFor({ state: "hidden", timeout: 10_000 });
    const deleteDeadline = Date.now() + 10_000;
    while (Date.now() < deleteDeadline) {
      if (await item.locator(".uploaded_list_item").count() < beforeCount) break;
      await page.waitForTimeout(100);
    }
    if (await item.locator(".uploaded_list_item").count() >= beforeCount) {
      throw new Error(`DOUYIN_DRAMA_UPLOAD_STALLED_DELETE_NOT_CONFIRMED: ${label}; index=${index}`);
    }
  }
}

async function confirmImageCropDialogIfPresent(page: Page, label: string) {
  const cropDialog = page
    .locator("[role='dialog']:visible, .arco-modal:visible")
    .filter({ hasText: /裁剪|调整封面|编辑图片/ })
    .last();
  const appeared = await cropDialog.waitFor({ state: "visible", timeout: 1_500 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return;
  const confirm = cropDialog
    .getByRole("button", { name: /确定|完成|保存/ })
    .filter({ visible: true })
    .last();
  await confirm.waitFor({ state: "visible", timeout: 10_000 });
  await confirm.click();
  await cropDialog.waitFor({ state: "hidden", timeout: 30_000 }).catch(() => {
    throw new Error(`DOUYIN_DRAMA_COVER_CROP_NOT_CONFIRMED: ${label}`);
  });
}

export async function uploadFormFiles(
  page: Page,
  label: string,
  files: string[],
  timeoutMs = 120_000,
  controlId?: string,
) {
  if (files.length === 0) return;
  const control = controlId
    ? page.locator(`#${controlId}`).first()
    : undefined;
  if (control) await control.waitFor({ state: "attached", timeout: 10_000 });
  const item = control
    ? control.locator("xpath=ancestor::*[contains(@class, 'arco-form-item')][1]")
    : douyinFormItem(page, label);
  if (!control) {
    const visible = await item.waitFor({ state: "visible", timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (!visible) throw new Error(`DOUYIN_DRAMA_UPLOAD_CONTROL_NOT_FOUND: ${label}`);
  }
  if (control) {
    // NovelCloudFileUploadItem renders multiple hidden inputs. Assigning files
    // to either input directly does not reliably enter its cloud-upload queue.
    // Drive the visible drop zone and use the chooser opened by the component,
    // which is the same path as a user selecting files in the browser dialog.
    await chooseCloudUploadFiles(page, control, label, files, timeoutMs);
  } else {
    const input = item.locator('input[type="file"]').first();
    await input.waitFor({ state: "attached", timeout: 10_000 });
    await input.setInputFiles(files, { timeout: timeoutMs });
  }
  if (/封面/.test(label)) await confirmImageCropDialogIfPresent(page, label);
  try {
    await waitForUploadSettlement(page, item, label, timeoutMs, files.length);
  } catch (error) {
    if (!control || !(error instanceof DouyinUploadStalledAt100Error)) throw error;

    const retryFiles = error.stalledIndices.map((index) => files[index]).filter(Boolean);
    if (retryFiles.length !== error.stalledIndices.length) throw error;
    await deleteStalledCloudUploadItems(page, item, label, error.stalledIndices);

    let expectedCompletedCount = await item
      .locator(".uploaded_list_item:has(.file-status-text-success)")
      .count();
    for (const retryFile of retryFiles) {
      let lastError: unknown = error;
      let recovered = false;
      for (let retryAttempt = 1; retryAttempt <= 5; retryAttempt += 1) {
        await chooseCloudUploadFiles(page, control, label, [retryFile], timeoutMs);
        try {
          await waitForUploadSettlement(
            page,
            item,
            label,
            timeoutMs,
            expectedCompletedCount + 1,
          );
          expectedCompletedCount += 1;
          recovered = true;
          break;
        } catch (retryError) {
          lastError = retryError;
          if (!(retryError instanceof DouyinUploadStalledAt100Error)) throw retryError;
          await deleteStalledCloudUploadItems(page, item, label, retryError.stalledIndices);
        }
      }
      if (!recovered) {
        throw new Error(
          `DOUYIN_DRAMA_UPLOAD_NOT_CONFIRMED: ${label}; stalledAt100Retries=5; `
            + `file=${JSON.stringify(retryFile)}; lastError=${lastError instanceof Error ? lastError.message : String(lastError)}`,
        );
      }
    }
    await waitForUploadSettlement(page, item, label, timeoutMs, files.length);
  }
}

export async function fillDouyinSeriesDialog(
  page: Page,
  data: { coverFile: string; summary: string; title: string },
) {
  const addButton = page
    .getByRole("button", { name: "点击添加系列剧信息", exact: true })
    .filter({ visible: true })
    .first();
  await addButton.waitFor({ state: "visible", timeout: 10_000 });
  await addButton.click();

  const dialog = page
    .locator("[role='dialog']:visible, .arco-modal:visible")
    .filter({ hasText: "添加系列剧信息" })
    .last();
  await dialog.waitFor({ state: "visible", timeout: 10_000 });

  const seriesNameItem = dialog
    .locator(".arco-form-item")
    .filter({ has: dialog.getByText("系列剧名", { exact: true }) })
    .first();
  await seriesNameItem.locator("input").first().fill(data.title);

  const typeText = dialog.getByText(DOUYIN_DRAMA_SERIES_TYPE, { exact: true }).first();
  await typeText.waitFor({ state: "visible", timeout: 10_000 });
  await typeText.click();

  const coverItem = dialog
    .locator(".arco-form-item")
    .filter({ has: dialog.getByText("系列剧封面", { exact: true }) })
    .first();
  const coverInput = coverItem.locator('input[type="file"]').first();
  await coverInput.waitFor({ state: "attached", timeout: 10_000 });
  await coverInput.setInputFiles(data.coverFile, { timeout: 120_000 });
  await confirmImageCropDialogIfPresent(page, "系列剧封面");
  await waitForUploadSettlement(page, coverItem, "系列剧封面");

  const summary = dialog.locator("#series_abstract_input, textarea").first();
  await summary.waitFor({ state: "visible", timeout: 10_000 });
  await summary.fill(data.summary);

  const confirm = dialog
    .getByRole("button", { name: "确定", exact: true })
    .filter({ visible: true })
    .last();
  await confirm.click();
  await dialog.waitFor({ state: "hidden", timeout: 15_000 });
  await assertNoDouyinFormError(page, "填写系列剧信息");
}

async function fillRoleDialogField(dialog: Locator, labels: string[], value?: string) {
  if (!value) return false;
  for (const label of labels) {
    const item = dialog
      .locator(".arco-form-item")
      .filter({ has: dialog.getByText(label, { exact: true }) })
      .first();
    if (await item.count()) {
      const input = item.locator("input, textarea").first();
      if (await input.count()) {
        await input.fill(value);
        return true;
      }
    }
  }
  return false;
}

export async function addDouyinRole(page: Page, role: DouyinDramaRole) {
  const addButton = page
    .getByRole("button", { name: /添加角色弹窗|至少添加2个角色/ })
    .filter({ visible: true })
    .first();
  await addButton.waitFor({ state: "visible", timeout: 10_000 });
  await addButton.click();
  const dialog = page.locator("[role='dialog']:visible, .arco-modal:visible").last();
  await dialog.waitFor({ state: "visible", timeout: 10_000 });

  const filledRoleName = await fillRoleDialogField(
    dialog,
    ["角色姓名", "角色名称", "角色名", "角色"],
    role.name,
  );
  const filledActorName = await fillRoleDialogField(
    dialog,
    ["演员姓名", "演员", "配音演员"],
    role.actorName,
  );
  const inputs = dialog.locator("input:visible, textarea:visible");
  if (!filledRoleName && (await inputs.count()) > 0) await inputs.nth(0).fill(role.name);
  if (!filledActorName && role.actorName && (await inputs.count()) > 1) {
    await inputs.nth(1).fill(role.actorName);
  }
  const roleType = role.roleType ?? "配角";
  const roleTypeTrigger = dialog.locator("#role_type_input, [role='combobox']").first();
  await roleTypeTrigger.waitFor({ state: "visible", timeout: 10_000 });
  await roleTypeTrigger.click();
  const roleTypeOption = page
    .locator(".arco-select-popup:visible [role='option'], .arco-select-popup:visible .arco-select-option")
    .filter({ hasText: exactTextPattern(roleType), visible: true })
    .first();
  await roleTypeOption.waitFor({ state: "visible", timeout: 10_000 });
  await roleTypeOption.click();

  const intro = dialog.locator("#role_intro_input, textarea").first();
  await intro.waitFor({ state: "visible", timeout: 10_000 });
  await intro.fill(role.intro ?? `${role.name}是本剧重要角色。`);

  if (!role.photoFile) throw new Error(`DOUYIN_DRAMA_ROLE_PHOTO_REQUIRED: ${role.name}`);
  const photoInput = dialog.locator([
    "#role_photo_url_input input[type='file']",
    "#role_photo_url input[type='file']",
    ".role-photo-url-item input[type='file']",
    "input[type='file'][accept*='.png']",
  ].join(", ")).first();
  await photoInput.waitFor({ state: "attached", timeout: 10_000 });
  const rolePhotoItem = photoInput.locator(
    "xpath=ancestor::*[contains(@class, 'role-photo-url-item')][1]",
  );
  const photoItem = await rolePhotoItem.count() ? rolePhotoItem : dialog;
  await photoInput.setInputFiles(role.photoFile, { timeout: 120_000 });
  await confirmImageCropDialogIfPresent(page, "角色照片");
  await waitForUploadSettlement(page, photoItem, "角色照片");

  const uploadedPhoto = dialog.locator([
    ".role-photo-url-item .arco-upload-list-item",
    ".role-photo-url-item .arco-upload-list-picture-card",
    ".role-photo-url-item .arco-upload-list img",
  ].join(", ")).first();
  const rolePhotoUri = dialog.locator("#role_photo_uri_input").first();
  const uploadDeadline = Date.now() + 120_000;
  let photoUploadConfirmed = false;
  while (Date.now() < uploadDeadline) {
    await assertNoDouyinFormError(page, `上传角色照片=${role.name}`);
    const previewVisible = await uploadedPhoto.isVisible().catch(() => false);
    const uri = await rolePhotoUri.inputValue().catch(() => "");
    if (previewVisible || uri.trim()) {
      photoUploadConfirmed = true;
      break;
    }
    await page.waitForTimeout(500);
  }
  if (!photoUploadConfirmed) {
    throw new Error(`DOUYIN_DRAMA_ROLE_PHOTO_UPLOAD_NOT_CONFIRMED: ${role.name}`);
  }

  const confirm = dialog
    .getByRole("button", { name: "确定", exact: true })
    .filter({ visible: true })
    .last();
  await confirm.waitFor({ state: "visible", timeout: 10_000 });
  await confirm.click();
  const closed = await dialog.waitFor({ state: "hidden", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!closed) {
    await assertNoDouyinFormError(page, `添加角色=${role.name}`);
    throw new Error(`DOUYIN_DRAMA_ROLE_DIALOG_NOT_CONFIRMED: 点击确定后角色弹窗仍未关闭：${role.name}`);
  }
}

export async function assertNoDouyinFormError(page: Page, action: string) {
  const errors = page.locator([
    ".arco-message-error:visible",
    ".arco-message-warning:visible",
    ".arco-form-message:visible",
    ".arco-alert-error:visible",
    "[class*='form-error']:visible",
  ].join(", "));
  // Do not inspect every role=alert surface. The publish-configuration page
  // contains a persistent informational Arco alert whose copy says settings
  // are "不可修改"; treating that advisory text as validation blocks the
  // workflow immediately after the video step has already succeeded.
  const messages = (await errors.allTextContents())
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((text) => !isTransientDouyinUploadMessage(text));
  if (messages.length > 0) {
    throw new Error(`DOUYIN_DRAMA_FORM_ERROR: ${action}: ${[...new Set(messages)].join("；")}`);
  }
}

export function isTransientDouyinUploadMessage(message: string) {
  return /资源上传中请等待|上传中.*请等待|正在上传/.test(message.replace(/\s+/g, " ").trim());
}

export async function clickDouyinNext(page: Page) {
  const button = page
    .getByRole("button", { name: "下一步", exact: true })
    .filter({ visible: true })
    .last();
  await button.waitFor({ state: "visible", timeout: 10_000 });
  await button.click();
  await page.waitForTimeout(800);
  await assertNoDouyinFormError(page, "下一步");
}
