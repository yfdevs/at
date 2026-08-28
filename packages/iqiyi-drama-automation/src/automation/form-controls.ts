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
      const choice = root.getByRole(role, { name: value, exact: true })
        .filter({ visible: true }).last();
      if (await choice.count() === 0) continue;
      await choice.click({ timeout: 10_000 });
      return true;
    }
    const radio = root.getByText(value, { exact: true }).filter({ visible: true }).last();
    if (await radio.count() === 0) {
      if (config.required) throw new Error(`IQIYI_DRAMA_RADIO_NOT_FOUND: ${value}`);
      return false;
    }
    await radio.click({ timeout: 10_000 });
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
  if (config.files.length === 0) return false;
  const root = await visibleField(page, config.aliases);
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
  await input.setInputFiles(config.files, { timeout: 120_000 });
  await page.waitForTimeout(800);
  if (config.settleCoverEditor) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const dialog = page.locator("[role='dialog'],.mp-modal,.mp-dialog,.ant-modal,.el-dialog")
        .filter({ hasText: /裁剪|封面/, visible: true }).last();
      if (await dialog.count() === 0) break;
      const confirm = dialog.getByRole("button", { name: /^(确定|确认|完成|保存)$/ })
        .filter({ visible: true }).last();
      if (await confirm.count() === 0) break;
      await confirm.click({ timeout: 10_000 });
      await page.waitForTimeout(500);
    }
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
