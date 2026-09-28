import path from "node:path";
import type { Locator, Page } from "playwright";
import {
  TAOBAO_DRAMA_FIXED_FIELDS,
  TAOBAO_DRAMA_MIN_SETTLE_MS,
} from "../shared/constants.js";
import { log } from "../shared/logger.js";
import type { TaobaoDramaRuntimeOptions, TaobaoDramaTaskPayload } from "../shared/types.js";
import { isTaobaoCreatorSuccessNavigation } from "./browser-session.js";

const fieldContainerSelector = [
  ".next-form-item",
  ".ant-form-item",
  ".semi-form-field",
  "[class*='formItem']",
  "[class*='form-item']",
  "[class*='FormItem']",
].join(", ");
const validationSelector = [
  ".next-form-item-help:visible",
  ".ant-form-item-explain-error:visible",
  ".semi-form-field-error-message:visible",
  "[class*='formError']:visible",
  "[class*='form-error']:visible",
].join(", ");

function exactText(value: string) {
  return new RegExp(`^\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
}

function fieldLabelText(value: string) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*\\*?\\s*${escaped}\\s*\\*?\\s*$`);
}

async function firstVisible(candidates: Locator[]) {
  for (const candidate of candidates) {
    const locator = candidate.filter({ visible: true }).first();
    if (await locator.isVisible({ timeout: 300 }).catch(() => false)) return locator;
  }
  return null;
}

async function fieldContainer(page: Page, labels: string[]) {
  for (const label of labels) {
    const text = page.getByText(fieldLabelText(label)).filter({ visible: true }).last();
    if (!(await text.isVisible({ timeout: 500 }).catch(() => false))) continue;
    const known = text.locator(`xpath=ancestor::*[${fieldContainerSelector
      .split(", ")
      .map((selector) => selector.startsWith(".")
        ? `contains(concat(' ', normalize-space(@class), ' '), ' ${selector.slice(1)} ')`
        : selector.includes("formItem")
          ? "contains(@class, 'formItem')"
          : selector.includes("FormItem")
            ? "contains(@class, 'FormItem')"
            : selector.includes("form-item")
              ? "contains(@class, 'form-item')"
              : "false()")
      .join(" or ")}][1]`);
    if (await known.count()) return known;
    return text.locator("xpath=ancestor::div[.//input or .//textarea or .//button][1]");
  }
  throw new Error(`TAOBAO_DRAMA_FIELD_NOT_FOUND: labels=${labels.join("|")}`);
}

async function fillTextField(page: Page, labels: string[], value: string) {
  const container = await fieldContainer(page, labels);
  const input = await firstVisible([
    container.locator("input:not([type='radio']):not([type='checkbox']):not([type='file'])"),
    container.locator("textarea"),
  ]);
  if (!input) throw new Error(`TAOBAO_DRAMA_TEXTBOX_NOT_FOUND: labels=${labels.join("|")}`);
  await input.scrollIntoViewIfNeeded({ timeout: 10_000 });
  await input.fill(value, { timeout: 30_000 });
  await input.press("Tab").catch(() => undefined);
}

async function visiblePopupOption(page: Page, value: string) {
  return firstVisible([
    page.getByRole("option", { name: exactText(value) }),
    page.locator("[role='menuitem'], [role='checkbox']").filter({ hasText: exactText(value) }),
    page.locator(".next-menu-item, .ant-select-item-option, .semi-select-option")
      .filter({ hasText: exactText(value) }),
  ]);
}

export async function selectTaobaoFieldValue(
  page: Page,
  labels: string[],
  value: string,
  multi = false,
) {
  const container = await fieldContainer(page, labels);
  const nativeControl = await firstVisible([
    container.getByRole("radio", { name: exactText(value) }),
    container.getByRole("checkbox", { name: exactText(value) }),
  ]);
  if (nativeControl) {
    if (!await nativeControl.isChecked().catch(() => false)) {
      await nativeControl.click({ timeout: 15_000 });
    }
    return;
  }

  const trigger = await firstVisible([
    container.locator("[role='combobox']"),
    container.locator(".next-select, .ant-select, .semi-select"),
    container.locator("input:not([type='hidden']):not([type='file'])"),
    container.locator("button"),
  ]);

  if (!trigger) {
    const inlineControl = await firstVisible([
      container.locator("[role='radio'], [role='checkbox'], label, button")
        .filter({ hasText: exactText(value) }),
      container.getByText(exactText(value)),
    ]);
    if (!inlineControl) {
      throw new Error(`TAOBAO_DRAMA_SELECT_NOT_FOUND: labels=${labels.join("|")}`);
    }
    await inlineControl.click({ timeout: 15_000 });
    return;
  }

  if (multi) {
    const selectedToken = await firstVisible([
      container.locator(
        "[aria-selected='true'], [data-selected='true'], " +
        "[class*='selected'], [class*='selection-item'], [class*='tag']",
      ).filter({ hasText: exactText(value) }),
    ]);
    if (selectedToken) return;
    const alreadyOpenOption = await visiblePopupOption(page, value);
    if (alreadyOpenOption) {
      await alreadyOpenOption.click({ timeout: 15_000 });
      return;
    }
  }

  await trigger.scrollIntoViewIfNeeded({ timeout: 10_000 });
  await trigger.click({ timeout: 15_000 });
  const option = await visiblePopupOption(page, value);
  if (!option) {
    throw new Error(
      `TAOBAO_DRAMA_SELECT_OPTION_NOT_FOUND: labels=${labels.join("|")} value=${value}`,
    );
  }
  await option.waitFor({ state: "visible", timeout: 15_000 });
  await option.click({ timeout: 15_000 });
  if (!multi) await page.keyboard.press("Escape").catch(() => undefined);
}

async function uploadCover(page: Page, coverFile: string) {
  const container = await fieldContainer(page, ["封面", "合集封面", "短剧封面"]);
  const input = container.locator("input[type='file']:not([disabled])").first();
  await input.waitFor({ state: "attached", timeout: 30_000 });
  await input.setInputFiles(coverFile, { timeout: 60_000 });

  const cropDialog = page
    .locator(".next-dialog:visible, .ant-modal:visible, .semi-modal:visible, [role='dialog']:visible")
    .filter({ has: page.locator("img, canvas") })
    .last();
  if (await cropDialog.isVisible({ timeout: 3_000 }).catch(() => false)) {
    const confirm = cropDialog
      .getByRole("button", { name: /^\s*(?:确定|确认|完成|保存)\s*$/ })
      .filter({ visible: true })
      .last();
    await confirm.click({ timeout: 30_000 });
    await cropDialog.waitFor({ state: "hidden", timeout: 30_000 });
  }

  const preview = container.locator("img:visible, [class*='upload-list']:visible").first();
  await preview.waitFor({ state: "visible", timeout: 60_000 }).catch(async (error) => {
    const assigned = await input.evaluate((element: HTMLInputElement) => element.files?.length ?? 0);
    if (assigned < 1) throw error;
  });
}

async function visibleValidationMessages(page: Page) {
  const messages = (await page.locator(validationSelector).allInnerTexts().catch(() => []))
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (await page.locator("[aria-invalid='true']:visible").count().catch(() => 0)) {
    messages.push("存在未通过校验的字段");
  }
  return [...new Set(messages)];
}

async function createSucceeded(page: Page) {
  if (isTaobaoCreatorSuccessNavigation(page.url(), "collection")) return true;
  return page
    .getByText(/创建成功|合集创建成功|已创建/)
    .filter({ visible: true })
    .first()
    .isVisible()
    .catch(() => false);
}

export async function fillAndCreateTaobaoCollection(
  page: Page,
  task: TaobaoDramaTaskPayload,
  coverFile: string,
  options: TaobaoDramaRuntimeOptions,
) {
  log(options, "[taobao-drama] 开始填写合集必填信息");
  await fillTextField(page, ["合集标题", "合集名称", "短剧名称", "标题"], task.title);
  await selectTaobaoFieldValue(page, ["合集类型"], TAOBAO_DRAMA_FIXED_FIELDS.collectionType);
  await selectTaobaoFieldValue(page, ["短剧类型"], task.shortDramaType);
  await selectTaobaoFieldValue(page, ["付费方式"], TAOBAO_DRAMA_FIXED_FIELDS.paymentMode);
  for (const tag of task.shortDramaTags) {
    await selectTaobaoFieldValue(page, ["短剧标签", "标签"], tag, true);
  }
  await page.keyboard.press("Escape").catch(() => undefined);
  await selectTaobaoFieldValue(page, ["是否完结", "完结状态"], TAOBAO_DRAMA_FIXED_FIELDS.completionStatus);
  await selectTaobaoFieldValue(page, ["观看受众", "受众"], task.audience);
  await uploadCover(page, coverFile);
  await selectTaobaoFieldValue(page, ["备案类型"], TAOBAO_DRAMA_FIXED_FIELDS.filingType);
  await fillTextField(page, ["制片人"], TAOBAO_DRAMA_FIXED_FIELDS.producerName);
  await fillTextField(page, ["制作机构"], TAOBAO_DRAMA_FIXED_FIELDS.productionCompany);
  await fillTextField(page, ["导演"], TAOBAO_DRAMA_FIXED_FIELDS.directorName);
  await fillTextField(
    page,
    ["集均时长(分钟)", "集均时长（分钟）", "集均时长"],
    String(TAOBAO_DRAMA_FIXED_FIELDS.averageEpisodeDurationMinutes),
  );

  const createButton = page
    .getByRole("button", { name: /^\s*(?:创建合集|创建)\s*$/ })
    .filter({ visible: true })
    .last();
  await createButton.waitFor({ state: "visible", timeout: 30_000 });
  await createButton.click({ timeout: 30_000 });
  let clickedAt = Date.now();
  const confirmDialog = page
    .locator(".next-dialog:visible, .ant-modal:visible, .semi-modal:visible, [role='dialog']:visible")
    .filter({ hasText: /创建/ })
    .last();
  if (await confirmDialog.isVisible({ timeout: 2_000 }).catch(() => false)) {
    const confirm = confirmDialog
      .getByRole("button", { name: /^\s*(?:确认创建|确定|确认)\s*$/ })
      .filter({ visible: true })
      .last();
    await confirm.click({ timeout: 30_000 });
    clickedAt = Date.now();
  }
  log(options, "[taobao-drama] 已点击创建合集，进入至少10秒结算期");

  let success = false;
  const deadline = clickedAt + 60_000;
  while (Date.now() < deadline) {
    const validation = await visibleValidationMessages(page);
    if (validation.length > 0) {
      throw new Error(`TAOBAO_DRAMA_COLLECTION_FORM_INVALID: ${validation.join("；")}`);
    }
    success ||= await createSucceeded(page);
    if (success && Date.now() - clickedAt >= TAOBAO_DRAMA_MIN_SETTLE_MS) break;
    await page.waitForTimeout(250);
  }
  if (!success) throw new Error("TAOBAO_DRAMA_COLLECTION_CREATE_RESULT_NOT_RECOGNIZED");
  const remaining = TAOBAO_DRAMA_MIN_SETTLE_MS - (Date.now() - clickedAt);
  if (remaining > 0) await page.waitForTimeout(remaining);
  log(options, "[taobao-drama] 合集创建成功且10秒结算期完成");
}

export type TaobaoUploadTextSummary = {
  matchedFileCount: number;
  completedFileCount: number;
  pending: boolean;
  failed: boolean;
  complete: boolean;
  progressText?: string;
};

export function summarizeTaobaoUploadText(text: string, fileNames: string[]): TaobaoUploadTextSummary {
  const normalized = text.replace(/\s+/g, " ");
  const baseNames = [...new Set(fileNames.map((file) => path.basename(file)))];
  const matchedFileCount = baseNames.filter((file) => normalized.includes(file)).length;
  const progressText = normalized.match(/(?:上传进度\s*)?\d+\s*\/\s*\d+|\b\d{1,3}%/)?.[0];
  const fraction = progressText?.match(/(\d+)\s*\/\s*(\d+)/);
  const completedFileCount = baseNames.filter((file) => {
    const fileStart = normalized.indexOf(file);
    if (fileStart < 0) return false;
    const statusStart = fileStart + file.length;
    const nextFileStart = baseNames.reduce((nearest, candidate) => {
      if (candidate === file) return nearest;
      const position = normalized.indexOf(candidate, statusStart);
      return position >= 0 && position < nearest ? position : nearest;
    }, normalized.length);
    const itemStatus = normalized.slice(statusStart, Math.min(nextFileStart, statusStart + 160));
    return /上传完成|上传成功|处理完成|处理成功|100%/.test(itemStatus);
  }).length;
  const fractionComplete = Boolean(
    fraction &&
      Number(fraction[2]) > 0 &&
      Number(fraction[1]) >= Number(fraction[2]) &&
      (baseNames.length === 0 || Number(fraction[2]) >= baseNames.length),
  );
  const complete = /(?:全部|所有)(?:视频|文件|剧集)?(?:上传|处理)(?:完成|成功)/.test(normalized) ||
    fractionComplete ||
    (baseNames.length > 0 && completedFileCount >= baseNames.length) ||
    (baseNames.length === 1 && /\b100%/.test(normalized));
  return {
    matchedFileCount,
    completedFileCount,
    pending: /上传中|正在上传|排队中|解析中|转码中|视频处理中|文件处理中|\b(?:[0-9]|[1-9][0-9])%/.test(normalized),
    failed: /上传失败|上传异常|解析失败|转码失败|发布失败|重新上传/.test(normalized),
    complete,
    progressText,
  };
}
