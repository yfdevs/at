import type { ElementHandle, Locator, Page } from "playwright";

export async function clickWhenReady(page: Page, locator: ReturnType<Page["getByText"]>) {
  await locator.waitFor({ state: "visible", timeout: 60_000 });
  await locator.click({ timeout: 30_000 });
  await page.waitForTimeout(300);
}

export async function scrollLocatorIntoView(_page: Page, locator: Locator) {
  const target = locator.filter({ visible: true }).first();
  await target.waitFor({ state: "visible", timeout: 60_000 });
  await target.scrollIntoViewIfNeeded({ timeout: 60_000 });
}

export function exactTextPattern(value: string) {
  return new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

function visibleMtdSelectPopper(page: Page) {
  return page.locator(".mtd-select-popper:visible, .mtd-select-dropdown:visible").last();
}

async function waitForVisibleLocator(_page: Page, locators: Locator[], timeout = 15_000) {
  const combined = locators.slice(1).reduce(
    (locator, nextLocator) => locator.or(nextLocator),
    locators[0],
  );
  const visible = combined.filter({ visible: true }).last();
  return visible
    .waitFor({ state: "visible", timeout })
    .then(() => visible)
    .catch(() => null);
}

async function fieldLabelLocator(page: Page, labelText: string) {
  const label = page
    .locator("label")
    .filter({ hasText: exactTextPattern(labelText) })
    .last();
  if (await label.count()) {
    return label;
  }

  return page
    .locator("span")
    .filter({ hasText: exactTextPattern(labelText) })
    .last();
}

async function formItemByLabelIfFound(page: Page, labelText: string) {
  const labels = [
    page.locator("label").filter({ hasText: exactTextPattern(labelText) }),
    page.locator("span").filter({ hasText: exactTextPattern(labelText) }),
    page.locator("label").filter({ hasText: labelText }),
    page.locator("span").filter({ hasText: labelText }),
  ];
  const label = await waitForVisibleLocator(page, labels, 5_000);
  if (!label) {
    return null;
  }

  const formItem = label.locator(
    "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' mtd-form-item ')][1]",
  );
  if (await formItem.count()) {
    return formItem;
  }

  const fallback = label.locator(
    "xpath=ancestor::*[.//input or .//textarea or .//*[contains(@class, 'mtd-select')]][1]",
  );
  if (await fallback.count()) {
    return fallback;
  }

  return null;
}

async function formItemByLabel(page: Page, labelText: string) {
  const formItem = await formItemByLabelIfFound(page, labelText);
  if (!formItem) {
    throw new Error(`MEITUAN_FORM_ITEM_NOT_FOUND: ${labelText}`);
  }

  return formItem;
}

async function clickFieldLabel(page: Page, labelText: string) {
  const label = await fieldLabelLocator(page, labelText);

  await scrollLocatorIntoView(page, label);
  await label.click({ timeout: 30_000 });
}

async function isElementHandleVisible(elementHandle: ElementHandle) {
  return elementHandle
    .evaluate((node) => {
      if (!node.isConnected) return false;

      const element = node as HTMLElement;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    })
    .catch(() => false);
}

async function closeDropdownIfStillOpen(
  page: Page,
  closeLabelText: string,
  sentinelHandle: ElementHandle,
) {
  if (!(await isElementHandleVisible(sentinelHandle))) {
    return;
  }

  await clickFieldLabel(page, closeLabelText);
  await page.waitForTimeout(300);

  if (await isElementHandleVisible(sentinelHandle)) {
    await clickFieldLabel(page, closeLabelText);
    await page.waitForTimeout(300);
  }
}

async function tagSelectTrigger(
  page: Page,
  labelText: string,
  triggerText: string,
) {
  const formItem = await formItemByLabel(page, labelText);
  const trigger = formItem
    .getByPlaceholder(triggerText, { exact: true })
    .or(formItem.getByText(triggerText, { exact: true }))
    .or(formItem.locator(".mtd-select-selection, .mtd-select-selector, .mtd-select"))
    .filter({ visible: true })
    .first();

  await trigger
    .waitFor({ state: "visible", timeout: 15_000 })
    .catch(() => {
      throw new Error(`MEITUAN_TAG_SELECT_TRIGGER_NOT_FOUND: ${labelText}=${triggerText}`);
    });
  return trigger;
}

export async function selectSingleTag(
  page: Page,
  labelText: string,
  triggerText: string,
  optionText: string,
) {
  const trigger = await tagSelectTrigger(page, labelText, triggerText);
  const option = page
    .locator("div")
    .filter({ hasText: exactTextPattern(optionText) })
    .last();

  await scrollLocatorIntoView(page, trigger);
  await trigger.click({ timeout: 30_000 });
  await page.waitForTimeout(300);

  await option.waitFor({ state: "visible", timeout: 30_000 });
  const optionHandle = await option.elementHandle();
  if (!optionHandle) {
    throw new Error(`MEITUAN_DROPDOWN_OPTION_NOT_FOUND: ${optionText}`);
  }

  await optionHandle.click({ timeout: 30_000 });
  await page.waitForTimeout(300);

  await closeDropdownIfStillOpen(page, labelText, optionHandle);
  await optionHandle.dispose();
}

export async function selectMultipleTags(
  page: Page,
  labelText: string,
  triggerText: string,
  optionTexts: string[],
) {
  const trigger = await tagSelectTrigger(page, labelText, triggerText);

  await scrollLocatorIntoView(page, trigger);
  await trigger.click({ timeout: 30_000 });
  await page.waitForTimeout(300);

  let lastOptionHandle: ElementHandle | null = null;

  for (const optionText of optionTexts) {
    const option = page
      .locator("div")
      .filter({ hasText: exactTextPattern(optionText) })
      .last();

    if (!(await option.isVisible({ timeout: 500 }).catch(() => false))) {
      await trigger.click({ timeout: 30_000 });
      await page.waitForTimeout(300);
    }

    await option.waitFor({ state: "visible", timeout: 30_000 });
    const optionHandle = await option.elementHandle();
    if (!optionHandle) {
      throw new Error(`MEITUAN_DROPDOWN_OPTION_NOT_FOUND: ${optionText}`);
    }

    await optionHandle.click({ timeout: 30_000 });
    await page.waitForTimeout(200);
    await lastOptionHandle?.dispose();
    lastOptionHandle = optionHandle;
  }

  if (lastOptionHandle) {
    await closeDropdownIfStillOpen(page, labelText, lastOptionHandle);
    await lastOptionHandle.dispose();
  }
}

async function textboxInFormItem(page: Page, labelText: string, placeholderText: string) {
  const formItem = await formItemByLabel(page, labelText);

  const byPlaceholder = formItem.getByPlaceholder(placeholderText, { exact: true }).first();
  if (await byPlaceholder.count()) {
    return byPlaceholder;
  }

  return formItem.locator("input, textarea, [contenteditable='true']").first();
}

async function readTextboxValue(textbox: Locator) {
  return textbox
    .evaluate((node) => {
      const element = node as HTMLInputElement | HTMLTextAreaElement | HTMLElement;

      if ("value" in element) {
        return String(element.value);
      }

      return element.textContent ?? "";
    })
    .catch(() => "");
}

async function forceSetTextboxValue(textbox: Locator, value: string) {
  await textbox.evaluate((node, nextValue) => {
    const element = node as HTMLInputElement | HTMLTextAreaElement | HTMLElement;

    if ("value" in element) {
      element.value = nextValue;
    } else {
      element.textContent = nextValue;
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

export async function fillTextbox(
  page: Page,
  labelText: string,
  placeholderText: string,
  value: string,
) {
  const textbox = await textboxInFormItem(page, labelText, placeholderText);

  await scrollLocatorIntoView(page, textbox);
  await textbox.click({ timeout: 30_000 });
  await textbox.fill(value, { timeout: 30_000 });
  await page.waitForTimeout(200);

  if ((await readTextboxValue(textbox)) === value) {
    return;
  }

  await textbox.click({ timeout: 30_000 });
  await textbox.press("Control+A").catch(() => undefined);
  await page.keyboard.insertText(value);
  await page.waitForTimeout(200);

  if ((await readTextboxValue(textbox)) === value) {
    return;
  }

  await forceSetTextboxValue(textbox, value);
  await page.waitForTimeout(200);

  if ((await readTextboxValue(textbox)) !== value) {
    throw new Error(`MEITUAN_TEXTBOX_FILL_FAILED: ${labelText}`);
  }
}

async function openCustomMultiTagSelect(
  page: Page,
  formItem: Locator,
  placeholderText: string,
) {
  const placeholder = formItem.getByText(placeholderText, { exact: true }).first();
  if (await placeholder.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await scrollLocatorIntoView(page, placeholder);
    await placeholder.click({ timeout: 30_000 });
    return;
  }

  const selectBox = formItem
    .locator(
      ".mtd-select-selection, .mtd-select-selector, .mtd-select-input, .mtd-select-tags, .mtd-select",
    )
    .first();

  await scrollLocatorIntoView(page, selectBox);
  await selectBox.click({ timeout: 30_000 });
}

async function mtdSelectOptionInVisiblePopper(page: Page, value: string, timeout = 30_000) {
  const popper = visibleMtdSelectPopper(page);
  await popper.waitFor({ state: "visible", timeout });

  const option = popper
    .locator(".mtd-select-option, [role='option']")
    .filter({ hasText: exactTextPattern(value) })
    .first();
  if (await option.isVisible({ timeout: 1_000 }).catch(() => false)) {
    return option;
  }

  const exactText = popper.getByText(value, { exact: true }).first();
  await exactText.waitFor({ state: "visible", timeout });

  const optionFromText = exactText
    .locator(
      "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' mtd-select-option ') or @role='option'][1]",
    )
    .first();
  if (await optionFromText.count()) {
    return optionFromText;
  }

  return exactText;
}

export async function selectCustomMultiTags(
  page: Page,
  labelText: string,
  placeholderText: string,
  values: string[],
) {
  const formItem = await formItemByLabel(page, labelText);
  const searchInput = formItem
    .locator(".mtd-select-search-field")
    .or(formItem.getByPlaceholder(placeholderText, { exact: true }))
    .or(formItem.locator("input, [contenteditable='true']"))
    .first();

  for (const value of values) {
    await openCustomMultiTagSelect(page, formItem, placeholderText);

    await searchInput.waitFor({ state: "visible", timeout: 30_000 });
    await scrollLocatorIntoView(page, searchInput);
    await searchInput.fill(value, { timeout: 30_000 });
    await page.waitForTimeout(300);

    const option = await mtdSelectOptionInVisiblePopper(page, value);
    await option.click({ timeout: 30_000 });
    await page.waitForTimeout(200);

    const selectedTag = formItem.getByText(value, { exact: true });
    if (!(await selectedTag.isVisible({ timeout: 1_000 }).catch(() => false))) {
      throw new Error(`MEITUAN_CUSTOM_TAG_SELECT_FAILED: ${labelText}=${value}`);
    }
  }
}
