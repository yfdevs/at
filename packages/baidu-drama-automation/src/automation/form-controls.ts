import type { Locator, Page } from "playwright";

function exactTextPattern(value: string) {
  return new RegExp(`^\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
}

export function baiduFormItem(page: Page, label: string) {
  return page
    .locator(".cheetah-form-item")
    .filter({ has: page.getByText(label, { exact: true }) })
    .first();
}

export async function fillByPlaceholder(page: Page, placeholder: string, value?: string) {
  if (value === undefined) return;
  const input = page.getByPlaceholder(placeholder, { exact: true }).first();
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await input.fill(value);
}

export async function fillFormItem(page: Page, label: string, value?: string | number) {
  if (value === undefined) return;
  const input = baiduFormItem(page, label).locator("input, textarea").first();
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await input.fill(String(value));
}

export async function selectFormItem(page: Page, label: string, value: string) {
  const item = baiduFormItem(page, label);
  const combobox = item.locator('[role="combobox"]').first();
  const trigger = (await combobox.count()) ? combobox : item.locator(".cheetah-select").first();
  await selectDropdownOption(page, trigger, value);
}

export async function selectDropdownOption(page: Page, trigger: Locator, value: string) {
  const currentValue = [
    await trigger.inputValue().catch(() => ""),
    await trigger.textContent().catch(() => ""),
    await trigger.getAttribute("title").catch(() => ""),
  ].filter(Boolean).join(" ");
  if (currentValue.trim() === value || currentValue.split(/\s+/).includes(value)) return;
  await trigger.click();
  const dropdown = page.locator(".cheetah-select-dropdown:visible").last();
  await dropdown.waitFor({ state: "visible", timeout: 10_000 });
  const option = dropdown
    .locator('[role="option"], .cheetah-select-item-option')
    .filter({ hasText: exactTextPattern(value), visible: true })
    .first();
  await option.waitFor({ state: "visible", timeout: 10_000 });
  await option.click();
}

export async function selectRadio(page: Page, label: string, value: string) {
  const item = baiduFormItem(page, label);
  const radioLabel = item
    .locator(".cheetah-radio-group label, [role=\"radiogroup\"] label")
    .filter({ hasText: exactTextPattern(value) })
    .first();
  await radioLabel.waitFor({ state: "visible", timeout: 10_000 });

  const input = radioLabel.locator('input[type="radio"]').first();
  if (!(await input.count())) {
    throw new Error(`BAIDU_DRAMA_RADIO_INPUT_NOT_FOUND: ${label}=${value}`);
  }
  if (!(await input.isChecked())) {
    await radioLabel.click();
    await page.waitForTimeout(100);
  }
  if (!(await input.isChecked())) {
    await input.check({ force: true });
  }
  if (!(await input.isChecked())) {
    throw new Error(`BAIDU_DRAMA_RADIO_NOT_SELECTED: ${label}=${value}`);
  }
}

export async function fillTagValues(page: Page, label: string, values: string[]) {
  const item = baiduFormItem(page, label);
  const input = item.locator('input[role="combobox"], input').first();
  for (const value of values) {
    await input.fill(value);
    await input.press("Enter");
  }
}

export async function setCheckbox(page: Page, label: string, checked: boolean) {
  const item = baiduFormItem(page, label);
  const input = item.locator('input[type="checkbox"]').first();
  if (await input.count()) {
    if ((await input.isChecked()) !== checked) await input.setChecked(checked);
    return;
  }
  const candidate = page.getByText(label, { exact: true }).last();
  const checkbox = candidate.locator("xpath=ancestor::label[1]").locator('input[type="checkbox"]');
  if ((await checkbox.isChecked()) !== checked) await candidate.click();
}

export async function ensureCheckboxByExactText(page: Page, text: string) {
  const tip = page.getByText(text, { exact: true }).filter({ visible: true }).first();
  await tip.waitFor({ state: "visible", timeout: 10_000 });

  const labelCheckbox = tip.locator("xpath=ancestor::label[1]").locator('input[type="checkbox"]').first();
  const wrapperCheckbox = tip
    .locator("xpath=ancestor::*[contains(@class, 'checkbox')][1]")
    .locator('input[type="checkbox"]')
    .first();
  const checkbox = (await labelCheckbox.count()) ? labelCheckbox : wrapperCheckbox;
  if ((await checkbox.count()) && await checkbox.isChecked()) return;

  await tip.click();
  if (!(await checkbox.count())) return;

  const deadline = Date.now() + 2_000;
  while (!(await checkbox.isChecked().catch(() => false)) && Date.now() < deadline) {
    await page.waitForTimeout(100);
  }
  if (!(await checkbox.isChecked().catch(() => false))) {
    throw new Error(`BAIDU_DRAMA_CHECKBOX_NOT_CHECKED: ${text}`);
  }
}

export async function uploadFormFiles(page: Page, label: string, files: string[]) {
  if (files.length === 0) return;
  const input = baiduFormItem(page, label).locator('input[type="file"]').first();
  await input.waitFor({ state: "attached", timeout: 10_000 });
  await input.setInputFiles(files);
  await page.waitForTimeout(500);
  await assertNoBaiduFormError(page, `上传${label}`);
}

export async function assertNoBaiduFormError(page: Page, action: string) {
  const errors = page.locator([
    ".cheetah-message-error:visible",
    ".cheetah-form-item-explain-error:visible",
    '[class*="message"][class*="error"]:visible',
  ].join(", "));
  const alerts = await page.locator('[role="alert"]:visible').allTextContents();
  const messages = [
    ...(await errors.allTextContents()),
    ...alerts.filter((text) => /失败|错误|不能|不可|请(?:上传|填写|输入|选择)|必填|超过|无效/.test(text)),
  ].map((text) => text.trim()).filter(Boolean);
  if (messages.length > 0) throw new Error(`BAIDU_DRAMA_FORM_ERROR: ${action}: ${messages.join("；")}`);
}

export async function clickBaiduNext(page: Page) {
  const button = page
    .locator("div")
    .filter({ hasText: /^\s*下一步\s*$/ })
    .locator("button")
    .last();
  await button.click();
  await page.waitForTimeout(500);
  await assertNoBaiduFormError(page, "下一步");
}

export async function confirmBaiduDramaInformation(page: Page) {
  const dialog = page
    .locator(".cheetah-modal-content:visible")
    .filter({ has: page.getByText("短剧信息确认", { exact: true }) })
    .last();
  await dialog.waitFor({ state: "visible", timeout: 10_000 });
  const confirm = dialog.getByRole("button", { name: "确定", exact: true }).last();
  await confirm.waitFor({ state: "visible", timeout: 10_000 });
  await confirm.click();
  await dialog.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {
    throw new Error("BAIDU_DRAMA_INFORMATION_CONFIRM_NOT_CLOSED");
  });
  await assertNoBaiduFormError(page, "确认短剧信息");
}

type CoverSlotState = {
  ready: boolean;
  hasImageBox: boolean;
  hasPlaceholder: boolean;
  previewBackgroundImage: string;
  previewImageSource: string;
};

export type BaiduCoverUploadReceipt = {
  slot: Locator;
  file: string;
};

async function coverSlotState(slot: Locator): Promise<CoverSlotState> {
  return slot.evaluate((root) => {
    const imageBox = root.querySelector(".bjh-image-box");
    const preview = root.querySelector(
      '.bjh-image-box .cover-uploader-view-image [role="image"], .bjh-image-box [role="image"]',
    );
    const previewImage = root.querySelector<HTMLImageElement>(".bjh-image-box img[src]");
    const previewBackgroundImage = preview ? getComputedStyle(preview).backgroundImage : "";
    const previewImageSource = previewImage?.currentSrc || previewImage?.src || "";
    const hasPreview = /url\(["']?.+["']?\)/i.test(previewBackgroundImage)
      || /^(?:blob:|data:image\/|https?:\/\/)/i.test(previewImageSource);
    return {
      ready: Boolean(imageBox && hasPreview),
      hasImageBox: Boolean(imageBox),
      hasPlaceholder: Boolean(root.querySelector(".container .placehold")),
      previewBackgroundImage,
      previewImageSource,
    };
  });
}

async function waitForCoverSlotReady(
  page: Page,
  slot: Locator,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  let current = await coverSlotState(slot);
  while (!current.ready && Date.now() < deadline) {
    await page.waitForTimeout(250);
    await assertNoBaiduFormError(page, "回填短剧封面");
    current = await coverSlotState(slot);
  }
  return current;
}

async function uploadCoverSlotAttempt(page: Page, slot: Locator, file: string) {
  await slot.click();
  const dialog = page
    .locator('[role="dialog"]:visible, .cheetah-modal-wrap:visible, .cheetah-modal-content:visible')
    .last();
  await dialog.waitFor({ state: "visible", timeout: 10_000 });
  const input = dialog.locator('input[type="file"][accept*="image"]').last();
  await input.waitFor({ state: "attached", timeout: 10_000 });
  await input.setInputFiles(file);

  const confirm = dialog.getByRole("button", { name: "确认", exact: true }).last();
  await confirm.waitFor({ state: "visible", timeout: 10_000 });
  const confirmDeadline = Date.now() + 60_000;
  while (!(await confirm.isEnabled().catch(() => false))) {
    if (Date.now() >= confirmDeadline) {
      const dialogText = await dialog.innerText().catch(() => "");
      throw new Error(
        `BAIDU_DRAMA_COVER_CONFIRM_NOT_READY: file=${file} ` +
          `dialog=${JSON.stringify(dialogText.replace(/\s+/g, " ").trim().slice(0, 300))}`,
      );
    }
    await page.waitForTimeout(500);
    await assertNoBaiduFormError(page, "上传短剧封面");
  }
  await assertNoBaiduFormError(page, "上传短剧封面");
  await confirm.click();
  await dialog.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {
    throw new Error(`BAIDU_DRAMA_COVER_CONFIRM_NOT_CLOSED: file=${file}`);
  });
  await assertNoBaiduFormError(page, "处理短剧封面");
}

export async function uploadCoverSlot(
  page: Page,
  slot: Locator,
  file: string,
  options: {
    label?: string;
    maxAttempts?: number;
    onRetry?: (message: string) => void;
  } = {},
): Promise<BaiduCoverUploadReceipt> {
  const initialState = await coverSlotState(slot);
  if (initialState.ready) return { slot, file };

  const maximumAttempts = Math.max(1, options.maxAttempts ?? 3);
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    await uploadCoverSlotAttempt(page, slot, file);
    const state = await waitForCoverSlotReady(page, slot, 15_000);
    if (state.ready) return { slot, file };
    if (attempt === maximumAttempts) {
      throw new Error(
        `BAIDU_DRAMA_COVER_SLOT_NOT_READY: file=${file} attempt=${attempt} ` +
          `slot=${options.label ?? "未知"} state=${JSON.stringify(state)}`,
      );
    }
    options.onRetry?.(
      `封面未回填，准备重试：槽位=${options.label ?? "未知"} ` +
        `attempt=${attempt + 1}/${maximumAttempts} state=${JSON.stringify(state)}`,
    );
  }
  throw new Error(`BAIDU_DRAMA_COVER_SLOT_NOT_READY: file=${file}`);
}

export async function assertBaiduCoverUploadReceipt(
  page: Page,
  receipt: BaiduCoverUploadReceipt,
) {
  const state = await waitForCoverSlotReady(page, receipt.slot, 5_000);
  if (!state.ready) {
    throw new Error(
      `BAIDU_DRAMA_COVER_SLOT_LOST: file=${receipt.file} ` +
        `state=${JSON.stringify(state)}`,
    );
  }
}
