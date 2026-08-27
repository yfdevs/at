import type { Locator, Page } from "playwright";
import type { DouyinDramaDropdownRecorder } from "../shared/dropdown-options.js";
import type { DouyinDramaRole } from "../shared/types.js";

function exactTextPattern(value: string) {
  return new RegExp(`^\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
}

export function douyinFormItem(page: Page, label: string) {
  return page
    .locator(".arco-form-item")
    .filter({ has: page.getByText(label, { exact: true }) })
    .first();
}

export async function fillInputById(page: Page, id: string, value?: string | number) {
  if (value === undefined) return;
  const input = page.locator(`#${id}`).first();
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await input.fill(String(value));
}

export async function fillFormItem(page: Page, label: string, value?: string | number) {
  if (value === undefined) return;
  const input = douyinFormItem(page, label).locator("input, textarea").first();
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await input.fill(String(value));
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

async function openDropdown(page: Page, trigger: Locator) {
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
    if (currentText.split(/\s+/).includes(value)) continue;
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
  return selected;
}

async function waitForUploadSettlement(page: Page, item: Locator, label: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let stablePasses = 0;
  while (Date.now() < deadline) {
    await assertNoDouyinFormError(page, `上传${label}`);
    const text = (await item.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    const busy = /上传中|处理中|等待上传|解析中|进度/.test(text) ||
      (await item.locator("[role='progressbar'], .arco-progress").count()) > 0;
    if (!busy) stablePasses += 1;
    else stablePasses = 0;
    if (stablePasses >= 3) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`DOUYIN_DRAMA_UPLOAD_TIMEOUT: ${label}`);
}

export async function uploadFormFiles(
  page: Page,
  label: string,
  files: string[],
  timeoutMs = 120_000,
) {
  if (files.length === 0) return;
  const item = douyinFormItem(page, label);
  const input = item.locator('input[type="file"]').first();
  await input.waitFor({ state: "attached", timeout: 10_000 });
  await input.setInputFiles(files, { timeout: timeoutMs });
  await waitForUploadSettlement(page, item, label, timeoutMs);
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
    ["角色名称", "角色名", "角色"],
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
  const confirm = dialog
    .getByRole("button", { name: /确定|保存|添加/ })
    .filter({ visible: true })
    .last();
  await confirm.waitFor({ state: "visible", timeout: 10_000 });
  await confirm.click();
  await dialog.waitFor({ state: "hidden", timeout: 15_000 });
}

export async function assertNoDouyinFormError(page: Page, action: string) {
  const errors = page.locator([
    ".arco-message-error:visible",
    ".arco-form-message:visible",
    ".arco-alert-error:visible",
    "[class*='form-error']:visible",
  ].join(", "));
  const alerts = await page.locator("[role='alert']:visible").allTextContents();
  const messages = [
    ...(await errors.allTextContents()),
    ...alerts.filter((text) => /失败|错误|不能|不可|请(?:上传|填写|输入|选择)|必填|超过|无效/.test(text)),
  ].map((text) => text.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (messages.length > 0) {
    throw new Error(`DOUYIN_DRAMA_FORM_ERROR: ${action}: ${[...new Set(messages)].join("；")}`);
  }
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
