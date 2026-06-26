import type { ElementHandle, Locator, Page } from "playwright";

export async function clickWhenReady(page: Page, locator: ReturnType<Page["getByText"]>) {
  await locator.waitFor({ state: "visible", timeout: 60_000 });
  await locator.click({ timeout: 30_000 });
  await page.waitForTimeout(300);
}

async function scrollPageOrDrawerDown(page: Page) {
  await page.evaluate(() => {
    const scrollableElements = Array.from(document.querySelectorAll<HTMLElement>("*"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const canScroll =
          /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 4;

        return (
          canScroll &&
          rect.width > 120 &&
          rect.height > 120 &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight &&
          element.scrollTop < element.scrollHeight - element.clientHeight
        );
      })
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return rightRect.height * rightRect.width - leftRect.height * leftRect.width;
      });

    const target = scrollableElements[0] ?? document.scrollingElement;
    target?.scrollBy({ top: 520, behavior: "instant" });
  });
  await page.waitForTimeout(200);
}

export async function scrollLocatorIntoView(page: Page, locator: Locator) {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    const attached = await locator
      .count()
      .then((count) => count > 0)
      .catch(() => false);

    if (attached) {
      await locator
        .first()
        .evaluate((node) => {
          const element = node as HTMLElement;
          element.scrollIntoView({ block: "center", inline: "nearest" });

          const scrollableAncestors: HTMLElement[] = [];
          let parent = element.parentElement;
          while (parent) {
            const style = window.getComputedStyle(parent);
            const canScroll =
              /(auto|scroll)/.test(style.overflowY) &&
              parent.scrollHeight > parent.clientHeight + 4;

            if (canScroll) {
              scrollableAncestors.push(parent);
            }

            parent = parent.parentElement;
          }

          for (const ancestor of scrollableAncestors) {
            const elementRect = element.getBoundingClientRect();
            const ancestorRect = ancestor.getBoundingClientRect();
            ancestor.scrollTop +=
              elementRect.top -
              ancestorRect.top -
              ancestor.clientHeight / 2 +
              elementRect.height / 2;
          }
        })
        .catch(() => undefined);
      await locator.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => undefined);

      const inViewport = await locator
        .first()
        .evaluate((node) => {
          const element = node as HTMLElement;
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);

          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.right > 0 &&
            rect.left < window.innerWidth &&
            rect.bottom > 0 &&
            rect.top < window.innerHeight &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        })
        .catch(() => false);

      if (inViewport) {
        await locator.waitFor({ state: "visible", timeout: 5_000 });
        return;
      }
    }

    await scrollPageOrDrawerDown(page);
  }

  throw new Error("MEITUAN_FIELD_NOT_IN_VIEWPORT");
}

async function locatorCenter(page: Page, locator: Locator) {
  await scrollLocatorIntoView(page, locator);
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("MEITUAN_DROPDOWN_TRIGGER_NOT_VISIBLE");
  }

  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

export function exactTextPattern(value: string) {
  return new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

function visibleMtdSelectPopper(page: Page) {
  return page.locator(".mtd-select-popper:visible, .mtd-select-dropdown:visible").last();
}

async function lastVisibleLocator(locators: Locator[]) {
  for (const locator of locators) {
    const count = await locator.count().catch(() => 0);

    for (let index = count - 1; index >= 0; index -= 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible({ timeout: 500 }).catch(() => false)) {
        return candidate;
      }
    }
  }

  return null;
}

async function waitForVisibleLocator(page: Page, locators: Locator[], timeout = 15_000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const locator = await lastVisibleLocator(locators);
    if (locator) {
      return locator;
    }

    await scrollPageOrDrawerDown(page);
  }

  return null;
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

export async function selectSingleTag(
  page: Page,
  labelText: string,
  triggerText: string,
  optionText: string,
) {
  const trigger = page.getByText(triggerText, { exact: true });
  const option = page
    .locator("div")
    .filter({ hasText: exactTextPattern(optionText) })
    .last();

  await trigger.waitFor({ state: "visible", timeout: 60_000 });
  const triggerCenter = await locatorCenter(page, trigger);
  await page.mouse.click(triggerCenter.x, triggerCenter.y);
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
  const trigger = page.getByText(triggerText, { exact: true });

  await trigger.waitFor({ state: "visible", timeout: 60_000 });
  const triggerCenter = await locatorCenter(page, trigger);
  await page.mouse.click(triggerCenter.x, triggerCenter.y);
  await page.waitForTimeout(300);

  let lastOptionHandle: ElementHandle | null = null;

  for (const optionText of optionTexts) {
    const option = page
      .locator("div")
      .filter({ hasText: exactTextPattern(optionText) })
      .last();

    if (!(await option.isVisible({ timeout: 500 }).catch(() => false))) {
      await page.mouse.click(triggerCenter.x, triggerCenter.y);
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

  await scrollLocatorIntoView(page, formItem);

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

export async function fillTextbox(page: Page, labelText: string, placeholderText: string, value: string) {
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

async function openCustomMultiTagSelect(formItem: Locator, placeholderText: string) {
  const placeholder = formItem.getByText(placeholderText, { exact: true }).first();
  if (await placeholder.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await placeholder.click({ timeout: 30_000 });
    return;
  }

  const selectBox = formItem
    .locator(
      ".mtd-select-selection, .mtd-select-selector, .mtd-select-input, .mtd-select-tags, .mtd-select",
    )
    .first();

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
    await scrollLocatorIntoView(page, formItem);
    await openCustomMultiTagSelect(formItem, placeholderText);

    await searchInput.waitFor({ state: "visible", timeout: 30_000 });
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
