import path from "node:path";

import type { Locator, Page } from "playwright";

import { log } from "../shared/logger.js";
import type { IqiyiDramaRuntimeOptions } from "../shared/types.js";

const fieldContainers = [
  ".ant-form-item",
  ".el-form-item",
  ".semi-form-field",
  ".mp-form-item",
  ".form-generator-item",
  ".form-item",
  ".field-item",
  "[class*='form-item']",
  "[class*='form_item']",
  "[class*='FormItem']",
  "[class*='formItem']",
].join(",");
const errorSelector = [
  ".ant-form-item-explain-error:visible",
  ".el-form-item__error:visible",
  ".semi-form-field-error-message:visible",
  ".mp-form-item__error:visible",
  "[class*='form-error']:visible",
  "[class*='errorMessage']:visible",
  "[role='alert']:visible",
].join(",");

function exact(value: string) {
  // 爱奇艺表单的必填星号可能位于标签前方（*定时上线）或后方。
  return new RegExp(
    `^\\s*\\*?\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[：:]?\\s*\\*?\\s*$`,
  );
}

async function visibleField(
  page: Page,
  aliases: readonly string[],
  placeholders: readonly string[] = [],
) {
  for (const alias of aliases) {
    const label = page.locator("label,.label,[class*='label'],[class*='Label']")
      .filter({ hasText: exact(alias), visible: true })
      .first();
    if (await label.count() === 0) continue;
    const root = label.locator(
      "xpath=ancestor::*[self::div or self::section or self::li][.//input or .//textarea or .//button][1]",
    );
    if (await root.count() > 0) return root;
  }
  for (const alias of aliases) {
    const root = page.locator(fieldContainers)
      .filter({ hasText: exact(alias), visible: true })
      .first();
    if (await root.count() > 0) return root;
  }
  for (const placeholder of placeholders) {
    const control = page.getByPlaceholder(placeholder, { exact: true })
      .filter({ visible: true })
      .first();
    if (await control.count() === 0) continue;
    const root = control.locator(
      "xpath=ancestor::*[self::div or self::section or self::li][1]",
    );
    if (await root.count() > 0) return root;
  }
  return null;
}

async function visibleLabelSummary(page: Page) {
  const values = await page.locator("label,.label,[class*='label'],[class*='Label']")
    .filter({ visible: true })
    .allTextContents()
    .catch(() => []);
  const labels = [...new Set(values
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => value.length > 0 && value.length <= 40))]
    .slice(0, 40);
  return labels.join(" | ") || "-";
}

async function selectOption(page: Page, value: string) {
  const option = page.locator([
    "[role='option']",
    ".ant-select-item-option",
    ".el-select-dropdown__item",
    ".semi-select-option",
    ".qy-select-option",
    "li",
  ].join(",")).filter({ hasText: exact(value), visible: true }).last();
  if (await option.count() === 0) throw new Error(`IQIYI_DRAMA_OPTION_NOT_FOUND: ${value}`);
  await option.click({ timeout: 10_000 });
}

async function iqiyiChoiceInput(choice: Locator) {
  const isInput = await choice.evaluate((element) =>
    element.matches("input[type='radio'],input[type='checkbox']")
  ).catch(() => false);
  return isInput
    ? choice
    : choice.locator("input[type='radio'],input[type='checkbox']").first();
}

async function iqiyiChoiceSelected(choice: Locator) {
  if (await choice.getAttribute("aria-checked").catch(() => null) === "true") return true;
  const input = await iqiyiChoiceInput(choice);
  return await input.count() > 0 && await input.isChecked().catch(() => false);
}

async function waitForIqiyiChoiceSelected(page: Page, choice: Locator, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await iqiyiChoiceSelected(choice)) return true;
    await page.waitForTimeout(50);
  } while (Date.now() < deadline);
  return iqiyiChoiceSelected(choice);
}

async function selectIqiyiChoice(page: Page, choice: Locator, value: string) {
  if (await iqiyiChoiceSelected(choice)) return;

  await choice.scrollIntoViewIfNeeded().catch(() => undefined);
  const visibleText = choice.getByText(value, { exact: true }).filter({ visible: true }).last();
  const clickTarget = await visibleText.count() > 0 ? visibleText : choice;
  await clickTarget.click({ force: true, timeout: 3000 }).catch(() => undefined);
  if (await waitForIqiyiChoiceSelected(page, choice)) return;

  await choice.evaluate((element) => (element as HTMLElement).click()).catch(() => undefined);
  if (await waitForIqiyiChoiceSelected(page, choice)) return;

  const input = await iqiyiChoiceInput(choice);
  if (await input.count() > 0) {
    await input.evaluate((element) => {
      const control = element as HTMLInputElement;
      if (!control.checked) control.click();
      if (control.checked) return;
      control.checked = true;
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  if (await waitForIqiyiChoiceSelected(page, choice)) return;

  throw new Error(`IQIYI_DRAMA_RADIO_SELECTION_FAILED: ${value}`);
}

export async function fillIqiyiField(
  page: Page,
  options: IqiyiDramaRuntimeOptions,
  config: {
    aliases: readonly string[];
    placeholders?: readonly string[];
    value: string | number | undefined;
    kind?: "text" | "textarea" | "select" | "radio" | "choice" | "date" | "tag";
    required?: boolean;
  },
) {
  if (config.value === undefined || config.value === "") {
    if (config.required) {
      throw new Error(`IQIYI_DRAMA_REQUIRED_FIELD_VALUE_MISSING: ${config.aliases[0]}`);
    }
    return false;
  }
  const root = await visibleField(page, config.aliases, config.placeholders);
  if (!root) {
    if (config.required) {
      throw new Error(
        `IQIYI_DRAMA_FIELD_NOT_FOUND: ${config.aliases.join("/")}; `
          + `visibleLabels=${await visibleLabelSummary(page)}`,
      );
    }
    return false;
  }
  const value = String(config.value);
  log(options, `[iqiyi-drama] filling field: ${config.aliases[0]}`);
  await root.scrollIntoViewIfNeeded().catch(() => undefined);
  if (config.kind === "radio" || config.kind === "choice") {
    for (const role of ["radio", "checkbox"] as const) {
      const explicitChoice = root.locator(`[role='${role}']`)
        .filter({ hasText: exact(value), visible: true }).last();
      const semanticChoice = root.getByRole(role, { name: value, exact: true })
        .filter({ visible: true }).last();
      const choice = await explicitChoice.count() > 0 ? explicitChoice : semanticChoice;
      if (await choice.count() === 0) continue;
      await selectIqiyiChoice(page, choice, value);
      return true;
    }
    const radio = root.getByText(value, { exact: true }).filter({ visible: true }).last();
    if (await radio.count() === 0) {
      if (config.required) throw new Error(`IQIYI_DRAMA_RADIO_NOT_FOUND: ${value}`);
      return false;
    }
    await radio.click({ force: true, timeout: 3000 });
    return true;
  }
  if (config.kind === "select") {
    const control = root.locator(
      "[role='combobox'],.ant-select-selector,.el-select,.semi-select,input:not([type='file'])",
    ).filter({ visible: true }).first();
    if (await control.count() === 0) {
      if (config.required) throw new Error(`IQIYI_DRAMA_SELECT_NOT_FOUND: ${config.aliases[0]}`);
      return false;
    }
    await control.click({ timeout: 10_000 });
    await page.waitForTimeout(250);
    await selectOption(page, value);
    return true;
  }
  const selector = config.kind === "textarea"
    ? "textarea,input:not([type='file'])"
    : "input:not([type='file']),textarea";
  const control = root.locator(selector).filter({ visible: true }).first();
  if (await control.count() === 0) {
    if (config.required) throw new Error(`IQIYI_DRAMA_INPUT_NOT_FOUND: ${config.aliases[0]}`);
    return false;
  }
  if (config.kind === "date") {
    await control.evaluate((element) => element.removeAttribute("readonly")).catch(() => undefined);
  }
  await control.fill(value, { timeout: 10_000 });
  if (config.kind === "tag") await control.press("Enter", { timeout: 10_000 });
  if (config.kind === "date") await control.press("Tab", { timeout: 10_000 });
  return true;
}

export async function openIqiyiSection(page: Page, label: string) {
  const tab = page.getByText(label, { exact: true }).filter({ visible: true }).last();
  if (await tab.count() === 0) throw new Error(`IQIYI_DRAMA_SECTION_NOT_FOUND: ${label}`);
  await tab.click({ timeout: 15_000 });
  await page.waitForTimeout(350);
}

async function clickAddPersonButton(
  page: Page,
  root: Locator,
  names: readonly string[],
) {
  for (const name of names) {
    const scoped = root.getByRole("button", { name: new RegExp(name) }).filter({ visible: true }).last();
    const button = await scoped.count() > 0
      ? scoped
      : page.getByRole("button", { name: new RegExp(name) }).filter({ visible: true }).last();
    if (await button.count() === 0) continue;
    await button.click({ timeout: 10_000 });
    await page.waitForTimeout(150);
    return;
  }
  throw new Error(`IQIYI_DRAMA_ADD_PERSON_BUTTON_NOT_FOUND: ${names.join("/")}`);
}

export async function fillIqiyiSearchPeople(
  page: Page,
  options: IqiyiDramaRuntimeOptions,
  config: {
    aliases: readonly string[];
    values: string[];
    inputPlaceholder: string | RegExp;
    addButtonNames: readonly string[];
    required?: boolean;
  },
) {
  if (config.values.length === 0) {
    if (config.required) throw new Error(`IQIYI_DRAMA_REQUIRED_PEOPLE_MISSING: ${config.aliases[0]}`);
    return false;
  }
  let root = await visibleField(page, config.aliases);
  if (!root) {
    if (config.required) throw new Error(`IQIYI_DRAMA_FIELD_NOT_FOUND: ${config.aliases.join("/")}`);
    return false;
  }
  for (let index = 0; index < config.values.length; index += 1) {
    if (index > 0) {
      await clickAddPersonButton(page, root, config.addButtonNames);
      root = await visibleField(page, config.aliases) ?? root;
    }
    const inputs = root.getByPlaceholder(config.inputPlaceholder, { exact: false })
      .filter({ visible: true });
    const input = inputs.last();
    if (await input.count() === 0) {
      throw new Error(`IQIYI_DRAMA_PERSON_INPUT_NOT_FOUND: ${config.aliases[0]}[${index}]`);
    }
    const value = config.values[index]!;
    log(options, `[iqiyi-drama] selecting ${config.aliases[0]}: ${value}`);
    await input.fill(value, { timeout: 10_000 });
    await page.waitForTimeout(500);
    const option = page.locator([
      "[role='option']",
      ".mp-select-dropdown__item",
      ".ant-select-item-option",
      ".el-select-dropdown__item",
      "[class*='suggest'] li",
      "[class*='dropdown'] li",
    ].join(",")).filter({ hasText: exact(value), visible: true }).last();
    const candidate = await option.count() > 0
      ? option
      : page.getByText(value, { exact: true }).filter({ visible: true }).last();
    if (await candidate.count() === 0) {
      throw new Error(`IQIYI_DRAMA_PERSON_OPTION_NOT_FOUND: ${config.aliases[0]}=${value}`);
    }
    await candidate.click({ timeout: 10_000 });
  }
  return true;
}

export async function fillIqiyiSimplePeople(
  page: Page,
  options: IqiyiDramaRuntimeOptions,
  config: {
    aliases: readonly string[];
    values: string[];
    inputPlaceholder: string | RegExp;
    addButtonNames: readonly string[];
    required?: boolean;
  },
) {
  if (config.values.length === 0) {
    if (config.required) throw new Error(`IQIYI_DRAMA_REQUIRED_PEOPLE_MISSING: ${config.aliases[0]}`);
    return false;
  }
  let root = await visibleField(page, config.aliases);
  if (!root) {
    if (config.required) throw new Error(`IQIYI_DRAMA_FIELD_NOT_FOUND: ${config.aliases.join("/")}`);
    return false;
  }
  for (let index = 0; index < config.values.length; index += 1) {
    if (index > 0) {
      await clickAddPersonButton(page, root, config.addButtonNames);
      root = await visibleField(page, config.aliases) ?? root;
    }
    const input = root.getByPlaceholder(config.inputPlaceholder, { exact: false })
      .filter({ visible: true }).last();
    if (await input.count() === 0) {
      throw new Error(`IQIYI_DRAMA_PERSON_INPUT_NOT_FOUND: ${config.aliases[0]}[${index}]`);
    }
    log(options, `[iqiyi-drama] filling ${config.aliases[0]}: ${config.values[index]}`);
    await input.fill(config.values[index]!, { timeout: 10_000 });
  }
  return true;
}

export async function fillIqiyiTags(
  page: Page,
  options: IqiyiDramaRuntimeOptions,
  config: { aliases: readonly string[]; values: string[]; required?: boolean },
) {
  if (config.values.length === 0) {
    if (config.required) throw new Error(`IQIYI_DRAMA_REQUIRED_TAGS_MISSING: ${config.aliases[0]}`);
    return false;
  }
  for (const value of config.values) {
    await fillIqiyiField(page, options, {
      aliases: config.aliases,
      value,
      kind: "tag",
      required: config.required,
    });
  }
  return true;
}

async function fileInput(root: Locator) {
  const input = root.locator("input[type='file']").first();
  return await input.count() > 0 ? input : null;
}

async function visibleUploadField(page: Page, aliases: readonly string[]) {
  for (const alias of aliases) {
    const title = page.getByText(alias, { exact: true }).filter({ visible: true }).last();
    if (await title.count() === 0) continue;
    const uploadSlot = title.locator(
      "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' upload-slot ')][1]",
    );
    if (await uploadSlot.count() > 0) return uploadSlot;
  }
  return visibleField(page, aliases);
}

async function waitForUploadSettled(
  page: Page,
  root: Locator,
  label: string,
) {
  const failure = root.getByText(/上传失败|文件上传失败|重新上传/).filter({ visible: true });
  const pending = root.locator([
    "[aria-busy='true']",
    "[class*='uploading']",
    "[class*='Uploading']",
    "[class*='progress']",
    "[class*='Progress']",
  ].join(",")).filter({ visible: true });
  let stablePolls = 0;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await failure.count() > 0) {
      throw new Error(`IQIYI_DRAMA_FILE_UPLOAD_FAILED: ${label}`);
    }
    const text = await root.innerText().catch(() => "");
    const isPending = await pending.count() > 0 || /上传中|正在上传|处理中/.test(text);
    stablePolls = isPending ? 0 : stablePolls + 1;
    if (stablePolls >= 2) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`IQIYI_DRAMA_FILE_UPLOAD_TIMEOUT: ${label}`);
}

async function settleIqiyiCoverEditor(page: Page, options: IqiyiDramaRuntimeOptions) {
  let confirmClicks = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const dialog = page.locator([
      ".mp-popup.base-popup-block",
      ".mp-popup",
      "[role='dialog']",
      ".mp-modal",
      ".mp-dialog",
      ".ant-modal",
      ".el-dialog",
    ].join(",")).filter({
      hasText: /设置封面图|裁剪\s*16:9|裁剪\s*3:4|封面/u,
      visible: true,
    }).last();
    const appeared = await dialog.waitFor({
      state: "visible",
      timeout: attempt === 0 ? 15_000 : 2_000,
    }).then(() => true, () => false);
    if (!appeared) break;

    await dialog.locator(".base-loading-block:not(.dn):visible")
      .waitFor({ state: "hidden", timeout: 30_000 })
      .catch(() => undefined);
    await dialog.locator(".cropper-container:visible,.thumbnail-preview img:visible")
      .first().waitFor({ state: "visible", timeout: 15_000 })
      .catch(() => undefined);

    const confirm = dialog.getByRole("button", { name: /^(确定|确认|完成|保存)$/u })
      .filter({ visible: true }).last();
    if (await confirm.count() === 0) {
      throw new Error("IQIYI_DRAMA_COVER_EDITOR_CONFIRM_NOT_FOUND");
    }
    await confirm.scrollIntoViewIfNeeded().catch(() => undefined);
    await confirm.click({ force: true, timeout: 5000 });
    confirmClicks += 1;
    log(options, `[iqiyi-drama] confirmed cover editor: ${confirmClicks}`);

    const closed = await dialog.waitFor({ state: "hidden", timeout: 10_000 })
      .then(() => true, () => false);
    if (closed) continue;
    if (attempt === 2) throw new Error("IQIYI_DRAMA_COVER_EDITOR_CONFIRM_FAILED");
    await page.waitForTimeout(500);
  }
  if (confirmClicks === 0) {
    log(options, "[iqiyi-drama] cover editor did not appear after upload");
  }
}

export async function uploadIqiyiFiles(
  page: Page,
  options: IqiyiDramaRuntimeOptions,
  config: {
    aliases: readonly string[];
    files: string[];
    required?: boolean;
    settleCoverEditor?: boolean;
  },
) {
  if (config.files.length === 0) {
    if (config.required) {
      throw new Error(`IQIYI_DRAMA_REQUIRED_FILES_MISSING: ${config.aliases[0]}`);
    }
    return false;
  }
  const root = await visibleUploadField(page, config.aliases);
  const input = root ? await fileInput(root) : null;
  if (!input) {
    if (config.required) {
      throw new Error(`IQIYI_DRAMA_FILE_INPUT_NOT_FOUND: ${config.aliases.join("/")}`);
    }
    return false;
  }
  log(
    options,
    `[iqiyi-drama] uploading ${config.aliases[0]}: ${config.files.map((file) => path.basename(file)).join(" | ")}`,
  );
  const supportsMultiple = await input.getAttribute("multiple") !== null;
  const batches = supportsMultiple
    ? [config.files]
    : config.files.map((file) => [file]);
  for (const [index, batch] of batches.entries()) {
    const currentInput = await fileInput(root!);
    if (!currentInput) {
      throw new Error(`IQIYI_DRAMA_FILE_INPUT_NOT_FOUND: ${config.aliases.join("/")}`);
    }
    log(options, `[iqiyi-drama] uploading ${config.aliases[0]} batch: ${index + 1}/${batches.length}`);
    await currentInput.setInputFiles(batch, { timeout: 120_000 });
    await waitForUploadSettled(page, root!, config.aliases[0]!);
  }
  if (config.settleCoverEditor) {
    await settleIqiyiCoverEditor(page, options);
  }
  await throwIfIqiyiFormInvalid(page);
  return true;
}

export async function throwIfIqiyiFormInvalid(page: Page) {
  const errors = [...new Set(
    (await page.locator(errorSelector).allInnerTexts().catch(() => []))
      .map((item) => item.replace(/\s+/g, " ").trim())
      .filter(Boolean),
  )];
  if (errors.length > 0) throw new Error(`IQIYI_DRAMA_FORM_INVALID: ${errors.join("；")}`);
}

export async function clickIqiyiButton(page: Page, names: readonly string[]) {
  for (const name of names) {
    const button = page.getByRole("button", { name, exact: true }).filter({ visible: true }).last();
    if (await button.count() === 0 || !await button.isEnabled().catch(() => false)) continue;
    await button.click({ timeout: 15_000 });
    return name;
  }
  return null;
}
