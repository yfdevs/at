import type { Page } from "playwright";
import { log } from "../../shared/logger.js";
import type { QqDramaRuntimeOptions, QqDramaTaskField, QqDramaTaskFile } from "../../shared/types.js";
import { downloadRemoteAsset } from "../remote-assets.js";

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fieldGroup(page: Page, label: string, index = 0) {
  const exactLabel = new RegExp(`^\\s*${escapeRegExp(label)}\\s*(?:\\*)?\\s*$`);
  return page.locator(".field-item,.form-item,.t-form__item,.ant-form-item,.el-form-item,[class*=form-item],[class*=FormItem]")
    .filter({
      has: page.locator("label,.field-label,.t-form__label,.ant-form-item-label,.el-form-item__label,[class*=label],[class*=Label]")
        .filter({ hasText: exactLabel }),
    })
    .nth(index);
}

async function fillBySelector(page: Page, selector: string, value: string) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  await locator.fill(value);
}

async function clickOptionByText(page: Page, value: string) {
  const option = page
    .locator("[role='option'], .t-select-option, .t-select__list-item, .ant-select-item-option, .el-select-dropdown__item, .semi-select-option, li")
    .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(value)}\\s*$`) })
    .last();
  await option.click({ timeout: 5_000 });
}

async function clickRadioInFieldGroup(page: Page, label: string, value: string, index: number) {
  const group = fieldGroup(page, label, index);
  if (await group.count() > 0) {
    await group.scrollIntoViewIfNeeded().catch(() => undefined);
    const radioLabel = group.locator(".t-radio,.ant-radio-wrapper,.el-radio,label").filter({
      hasText: new RegExp(`^\\s*${escapeRegExp(value)}\\s*$`),
    }).last();
    if (await radioLabel.count() > 0) {
      await radioLabel.click({ timeout: 10_000 });
      return;
    }
    const textOption = group.getByText(value, { exact: true }).last();
    if (await textOption.count() > 0) {
      await textOption.click({ timeout: 10_000 });
      return;
    }
  }

  await page.getByRole("radio", { name: value }).click({ timeout: 10_000 });
}

async function fillFieldControlInGroup(page: Page, field: QqDramaTaskField, value: string) {
  const label = field.label;
  if (!label) return false;
  const group = fieldGroup(page, label, field.index);
  if (await group.count() === 0) return false;

  await group.scrollIntoViewIfNeeded().catch(() => undefined);

  if (field.kind === "radio") {
    await clickRadioInFieldGroup(page, label, value, field.index);
    return true;
  }

  if (field.kind === "select") {
    const controls = field.placeholder
      ? group.locator(`input[placeholder="${field.placeholder}"]`)
      : group.locator("input:not([type='file'])");
    const control = controls.first();
    if (await control.count() === 0) return false;
    await control.click({ timeout: 10_000 });
    await page.waitForTimeout(300);
    await clickOptionByText(page, value);
    return true;
  }

  const control = field.placeholder
    ? group.locator(`input[placeholder="${field.placeholder}"], textarea[placeholder="${field.placeholder}"]`).first()
    : group.locator("input:not([type='file']), textarea").first();
  if (await control.count() === 0) return false;
  await control.fill(value, { timeout: 10_000 });
  return true;
}

export async function fillFieldByLabel(page: Page, field: QqDramaTaskField) {
  if (!field.label) {
    throw new Error("QQ_DRAMA_FIELD_LABEL_OR_SELECTOR_REQUIRED");
  }

  const value = String(field.value);
  const label = field.label;

  if (await fillFieldControlInGroup(page, field, value)) {
    return;
  }

  const exactLabel = page.getByLabel(label).nth(field.index);

  if (field.kind === "radio") {
    await clickRadioInFieldGroup(page, label, value, field.index);
    return;
  }

  if (field.kind === "select") {
    const combobox = page.getByLabel(label).nth(field.index);
    await combobox.click({ timeout: 10_000 });
    await clickOptionByText(page, value);
    return;
  }

  await exactLabel.fill(value, { timeout: 5_000 }).catch(async () => {
    const result = await page.evaluate(
      ({ targetLabel, targetValue, placeholder, index }) => {
        const normalize = (text: string | null | undefined) => text?.replace(/\s+/g, " ").trim() ?? "";
        const isVisible = (element: HTMLElement | null) => {
          if (!element) return false;
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        };
        const setValue = (element: HTMLInputElement | HTMLTextAreaElement) => {
          const prototype = element instanceof HTMLTextAreaElement
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
          const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
          if (descriptor?.set) descriptor.set.call(element, targetValue);
          else element.value = targetValue;
          element.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, data: targetValue }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          element.dispatchEvent(new Event("blur", { bubbles: true }));
        };

        const labels = Array.from(document.querySelectorAll<HTMLElement>("label,*"))
          .filter((element) => isVisible(element) && normalize(element.textContent).startsWith(targetLabel));
        const labelElement = labels[index] ?? null;
        const searchRoots = [
          labelElement?.closest<HTMLElement>(".field-item,.form-section,.ant-form-item,.el-form-item,.semi-form-field,.form-item,[class*='form']"),
          labelElement?.parentElement,
          document.body,
        ].filter((element): element is HTMLElement => Boolean(element));
        for (const root of searchRoots) {
          const controls = Array.from(
            root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input:not([type='file']), textarea"),
          ).filter(isVisible);
          const control = placeholder
            ? controls.find((element) => element.getAttribute("placeholder")?.includes(placeholder)) ?? controls[0]
            : controls[0];
          if (control) {
            setValue(control);
            return { ok: true };
          }
        }
        return { ok: false, labels: labels.map((element) => normalize(element.textContent).slice(0, 80)) };
      },
      {
        targetLabel: label,
        targetValue: value,
        placeholder: field.placeholder,
        index: field.index,
      },
    );

    if (!result.ok) {
      throw new Error(`QQ_DRAMA_FIELD_NOT_FOUND: label=${label}; visibleLabels=${(result.labels ?? []).join("|")}`);
    }
  });
}

export async function fillTaskField(page: Page, field: QqDramaTaskField) {
  if (field.selector) {
    await fillBySelector(page, field.selector, String(field.value));
    return;
  }

  await fillFieldByLabel(page, field);
}

export async function resolveTaskFilePath(file: QqDramaTaskFile, options: QqDramaRuntimeOptions) {
  if (file.path?.trim()) return file.path.trim();
  if (file.url?.trim()) {
    return downloadRemoteAsset(file.url.trim(), options, file.fileName ?? file.label ?? "asset");
  }
  throw new Error("QQ_DRAMA_FILE_URL_OR_PATH_REQUIRED");
}

async function markFileInputByLabel(page: Page, label: string) {
  const result = await page.evaluate((targetLabel) => {
    const normalize = (text: string | null | undefined) => text?.replace(/\s+/g, " ").trim() ?? "";
    const isVisible = (element: HTMLElement | null) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const markInput = (root: HTMLElement | null) => {
      const inputElement = root?.querySelector<HTMLInputElement>("input[type='file']");
      if (!inputElement) return false;
      inputElement.setAttribute("data-qq-drama-upload-target", "true");
      return true;
    };

    const exactField = Array.from(document.querySelectorAll<HTMLElement>(
      ".field-item,.form-item,.t-form__item,.ant-form-item,.el-form-item,[class*=form-item],[class*=FormItem]",
    )).find((element) => isVisible(element) && normalize(element.textContent).includes(targetLabel));
    if (markInput(exactField ?? null)) return true;

    const section = Array.from(document.querySelectorAll<HTMLElement>(".form-section"))
      .find((element) => isVisible(element) && normalize(element.textContent).includes(targetLabel));
    if (markInput(section ?? null)) return true;

    const labelElement = Array.from(document.querySelectorAll<HTMLElement>("label,*"))
      .find((element) => isVisible(element) && normalize(element.textContent).startsWith(targetLabel));
    const root = labelElement?.closest<HTMLElement>(
      ".field-item,.form-section,.ant-form-item,.el-form-item,.semi-form-field,.form-item,[class*='form']",
    ) ?? labelElement?.parentElement ?? null;
    return markInput(root);
  }, label);

  if (!result) {
    throw new Error(`QQ_DRAMA_FILE_INPUT_NOT_FOUND: label=${label}`);
  }
}

export async function uploadTaskFile(page: Page, file: QqDramaTaskFile, options: QqDramaRuntimeOptions) {
  const localFilePath = await resolveTaskFilePath(file, options);
  if (file.selector) {
    await page.locator(file.selector).first().setInputFiles(localFilePath, { timeout: 60_000 });
    return;
  }
  if (!file.label) {
    throw new Error("QQ_DRAMA_FILE_LABEL_OR_SELECTOR_REQUIRED");
  }

  await markFileInputByLabel(page, file.label);
  await page.locator("input[data-qq-drama-upload-target='true']").first().setInputFiles(localFilePath, {
    timeout: 60_000,
  });
  await page.locator("input[data-qq-drama-upload-target='true']").first().evaluate((element) => {
    element.removeAttribute("data-qq-drama-upload-target");
  }).catch(() => undefined);
}

export async function uploadLocalFilesByTarget(page: Page, options: {
  label?: string;
  selector?: string;
  files: string[];
}) {
  if (options.selector) {
    await page.locator(options.selector).first().setInputFiles(options.files, { timeout: 120_000 });
    return;
  }

  const label = options.label ?? "选择视频文件";
  const result = await page.evaluate((targetLabel) => {
    const normalize = (text: string | null | undefined) => text?.replace(/\s+/g, " ").trim() ?? "";
    const isVisible = (element: HTMLElement | null) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const visibleInputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[type='file']"))
      .filter((input) => {
        const root = input.closest<HTMLElement>(".field-item,.form-section,.ant-form-item,.el-form-item,.form-item,[class*='form']")
          ?? input.parentElement;
        return root ? isVisible(root) : true;
      });
    const videoInput = visibleInputs.find((input) => input.accept.includes("video"));
    if (videoInput) {
      videoInput.setAttribute("data-qq-drama-episode-upload-target", "true");
      return true;
    }

    const labelElement = Array.from(document.querySelectorAll<HTMLElement>("label,*"))
      .find((element) => isVisible(element) && normalize(element.textContent).startsWith(targetLabel));
    const root = labelElement?.closest<HTMLElement>(
      ".field-item,.form-section,.ant-form-item,.el-form-item,.semi-form-field,.form-item,[class*='form']",
    ) ?? labelElement?.parentElement;
    const inputElement = root?.querySelector<HTMLInputElement>("input[type='file']")
      ?? document.querySelector<HTMLInputElement>("input[type='file']");
    if (!inputElement) return false;
    inputElement.setAttribute("data-qq-drama-episode-upload-target", "true");
    return true;
  }, label);

  if (!result) {
    throw new Error(`QQ_DRAMA_EPISODE_FILE_INPUT_NOT_FOUND: label=${label}`);
  }

  await page.locator("input[data-qq-drama-episode-upload-target='true']").first().setInputFiles(options.files, {
    timeout: 120_000,
  });
  await page.locator("input[data-qq-drama-episode-upload-target='true']").first().evaluate((element) => {
    element.removeAttribute("data-qq-drama-episode-upload-target");
  }).catch(() => undefined);
}

export async function clickNextStep(page: Page, options: QqDramaRuntimeOptions, label = "下一步") {
  const button = page.getByRole("button", { name: label }).first();
  await button.waitFor({ state: "visible", timeout: 20_000 });
  log(options, `[qq-drama] clicking button: ${label}`);
  await button.click({ timeout: 20_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(1_000);
}
