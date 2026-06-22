import type { Locator, Page } from "playwright";
import { resolveFromRoot } from "../../shared/config.js";
import { ErrorType } from "../../shared/errors.js";
import type { Config } from "../../shared/types.js";
import {
  dramaTypeValues,
  monetizationValues,
  postUrl,
  qualificationValues,
  selectors,
  submissionIdentityValues,
  formGroup,
} from "../constants.js";
import {
  findVisibleLabeledGroup,
  prepareUploadFiles,
  setInputFilesByLocator,
  uploadInGroup,
  uploadBySelector,
  waitForUploadedFiles,
} from "../upload/upload-helpers.js";

async function fillFirstMatchingField(page: Page, fieldSelector: string, fieldValue: string | number, fieldLabel: string): Promise<void> {
  const fieldLocator = page.locator(fieldSelector).first();
  await fieldLocator.waitFor({ state: "visible", timeout: 20000 });
  await fieldLocator.fill(String(fieldValue));
  console.log(`[fill] ${fieldLabel}`);
}

function sanitizeDramaText(value: string, label: string): string {
  const sanitized = value.normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[–—]+/g, "—")
    .replace(/[!！、;；"“”#@&()（）+/*。.?？%]+/g, "，")
    .replace(/,/g, "，")
    .replace(/[^A-Za-z0-9\u3400-\u9FFF\uF900-\uFAFF，—《》\-·:：]+/g, "，")
    .replace(/，{2,}/g, "，")
    .replace(/^，+|，+$/g, "");

  if (!sanitized) {
    throw new Error(`data.playlet.${label} is empty after removing unsupported characters.`);
  }
  if (sanitized !== value) {
    console.warn(`[warn] ${label} 包含空格或不支持字符，已清洗为: ${sanitized}`);
  }
  return sanitized;
}

function createDramaNameValidationError(message: string): Error {
  return Object.assign(new Error(`[drama-name-validation-failed] ${message}`), {
    errorType: ErrorType.Validation,
  });
}

function validateDramaName(value: string): string {
  if (!value) {
    throw createDramaNameValidationError("data.playlet.name is required.");
  }
  if (/\s/.test(value)) {
    throw createDramaNameValidationError("data.playlet.name must not contain spaces.");
  }

  const edgeUnsupportedPattern = /^[！、；“”#@&（）+/*，。？%]|[！、；“”#@&（）+/*，。？%]$/u;
  if (edgeUnsupportedPattern.test(value)) {
    throw createDramaNameValidationError("data.playlet.name starts or ends with unsupported characters: ！、；“”#@&（）+/*，。？%");
  }

  const middleText = value.slice(1, -1);
  if (/[、；“”#@&（）+/*。？%]/u.test(middleText)) {
    throw createDramaNameValidationError("data.playlet.name contains unsupported middle characters: 、；“”#@&（）+/*。？%");
  }

  return value;
}

async function selectCheckboxOrRadioLocator(hiddenInput: Locator, inputLabel: string): Promise<void> {
  if (await hiddenInput.count() === 0) {
    console.warn(`[skip] selector not found for ${inputLabel}`);
    return;
  }

  const visibleIcon = hiddenInput.locator("xpath=following-sibling::i[1]").first();
  try {
    if (await visibleIcon.count() > 0 && await visibleIcon.isVisible()) {
      await visibleIcon.click({ timeout: 15000 });
    } else {
      await hiddenInput.check({ force: true, timeout: 15000 });
    }
  } catch (error) {
    await hiddenInput.evaluate((element) => {
      const input = element as HTMLInputElement;
      input.checked = true;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    console.warn(`[warn] fallback checked ${inputLabel}: ${message}`);
  }
  console.log(`[check] ${inputLabel}`);
}

async function fillFieldInsideLabeledGroup(page: Page, labelPrefix: string, fieldValue: string | number, _groupKey: string, fieldLabel = labelPrefix): Promise<boolean> {
  const group = await findVisibleLabeledGroup(page, labelPrefix, "input, textarea");
  if (!group) return false;

  const inputOrTextarea = group.locator("input:not([type]), input[type='text'], input[type='number'], textarea").first();
  if (await inputOrTextarea.count() === 0) {
    console.warn(`[skip] input not found for ${fieldLabel}`);
    return false;
  }

  await inputOrTextarea.fill(String(fieldValue), { timeout: 15000 });
  console.log(`[fill] ${fieldLabel}`);
  return true;
}

async function fillInGroupByPlaceholder(
  page: Page,
  groupLabelPrefix: string,
  _key: string,
  placeholder: string,
  fieldValue: string | number,
  label: string,
): Promise<boolean> {
  const group = await findVisibleLabeledGroup(page, groupLabelPrefix, `input[placeholder="${placeholder}"]`);
  if (!group) return false;

  const inputWithPlaceholder = group.locator(`input[placeholder="${placeholder}"]`).first();
  await inputWithPlaceholder.fill(String(fieldValue), { timeout: 15000 });
  console.log(`[fill] ${label}`);
  return true;
}

async function selectCheckboxOrRadio(page: Page, inputSelector: string, inputLabel: string): Promise<void> {
  const hiddenInput = page.locator(inputSelector).first();
  if (await hiddenInput.count() === 0) {
    console.warn(`[skip] selector not found for ${inputLabel}: ${inputSelector}`);
    return;
  }

  const visibleIcon = page.locator(`${inputSelector} + i`).first();
  try {
    if (await visibleIcon.count() > 0 && await visibleIcon.isVisible()) {
      await visibleIcon.click({ timeout: 15000 });
    } else {
      await hiddenInput.check({ force: true, timeout: 15000 });
    }
  } catch (error) {
    await hiddenInput.evaluate((element) => {
      const input = element as HTMLInputElement;
      input.checked = true;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    console.warn(`[warn] fallback checked ${inputLabel}: ${message}`);
  }
  console.log(`[check] ${inputLabel}`);
}

async function clickExactText(page: Page, text: string, label: string): Promise<boolean> {
  const locator = page.getByText(text, { exact: true }).first();
  if (await locator.count() === 0) return false;
  await locator.click({ timeout: 15000 });
  console.log(`[check] ${label}: ${text}`);
  return true;
}

async function checkRadioByLabel<Value extends string>(
  page: Page,
  labelPrefix: string,
  _key: string,
  values: Record<Value, string>,
  value: Value,
): Promise<void> {
  const radioGroup = await findVisibleLabeledGroup(page, labelPrefix, 'input[type="radio"]');
  if (!radioGroup) {
    console.warn(`[skip] control group not found for ${labelPrefix}`);
    return;
  }

  await selectCheckboxOrRadioLocator(
    radioGroup.locator(`input[type="radio"][value="${values[value]}"]`).first(),
    `${labelPrefix}: ${value}`,
  );
}

async function uploadMaterial(
  page: Page,
  labelPrefixes: string | string[],
  filePaths: Array<string | undefined>,
  label = Array.isArray(labelPrefixes) ? labelPrefixes[0] : labelPrefixes,
  remoteDirectoryName?: string,
): Promise<void> {
  const prefixes = Array.isArray(labelPrefixes) ? labelPrefixes : [labelPrefixes];
  console.log(`[upload-plan] ${label}: ${filePaths.filter(Boolean).length} file(s)`);
  if (!filePaths.some(Boolean)) return;
  await uploadByAnyLabelPrefix(page, prefixes, filePaths, label, remoteDirectoryName);
}

async function uploadByAnyLabelPrefix(
  page: Page,
  labelPrefixes: string[],
  filePaths: Array<string | undefined>,
  label: string,
  remoteDirectoryName?: string,
): Promise<void> {
  if (!filePaths.some(Boolean)) return;

  for (const labelPrefix of labelPrefixes) {
    const uploadGroup = await findVisibleLabeledGroup(page, labelPrefix, 'input[type="file"]');
    if (!uploadGroup) continue;
    await uploadInGroup(uploadGroup, filePaths, label, resolveFromRoot, remoteDirectoryName);
    return;
  }

  throw new Error(`[upload-failed] ${label}: control group not found: ${labelPrefixes.join(" / ")}`);
}

async function uploadByLabeledGroupFileInput(
  page: Page,
  labelPrefixes: string | string[],
  filePaths: Array<string | undefined>,
  label = Array.isArray(labelPrefixes) ? labelPrefixes[0] : labelPrefixes,
  remoteDirectoryName?: string,
): Promise<void> {
  const files = await prepareUploadFiles(filePaths, resolveFromRoot, remoteDirectoryName);
  if (!files.length) {
    console.warn(`[skip] ${label}: no existing file`);
    return;
  }

  const prefixes = Array.isArray(labelPrefixes) ? labelPrefixes : [labelPrefixes];
  for (const prefix of prefixes) {
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const exactGroup = page.locator(".weui-desktop-form__control-group")
      .filter({ has: page.locator('input[type="file"]') })
      .filter({
        has: page.locator("label.weui-desktop-form__label").filter({ hasText: new RegExp(`^\\s*${escapedPrefix}\\s*$`) }),
      })
      .first();
    if (await exactGroup.count()) {
      await setInputFilesByLocator(exactGroup.locator('input[type="file"]').first(), files, label, 10000);
      await waitForUploadedFiles(page, files, label);
      return;
    }
  }

  for (const prefix of prefixes) {
    const fuzzyGroup = page.locator(".weui-desktop-form__control-group")
      .filter({ has: page.locator('input[type="file"]') })
      .filter({
        has: page.locator("label.weui-desktop-form__label").filter({ hasText: prefix }),
      })
      .first();
    if (await fuzzyGroup.count()) {
      await setInputFilesByLocator(fuzzyGroup.locator('input[type="file"]').first(), files, label, 10000);
      await waitForUploadedFiles(page, files, label);
      return;
    }
  }

  for (const prefix of prefixes) {
    const textMatchedGroup = page.locator(".weui-desktop-form__control-group")
      .filter({ has: page.locator('input[type="file"]') })
      .filter({ hasText: prefix })
      .first();
    if (await textMatchedGroup.count()) {
      await setInputFilesByLocator(textMatchedGroup.locator('input[type="file"]').first(), files, label, 10000);
      await waitForUploadedFiles(page, files, label);
      return;
    }
  }

  throw new Error(`[upload-failed] ${label}: input[type=file] group not found`);
}

async function fillProducerName(page: Page, value: string): Promise<void> {
  const textbox = page.getByRole("textbox", { name: "请填写待提审剧目的制作方主体名称" }).first();
  if (await textbox.count() > 0) {
    await textbox.fill(value, { timeout: 15000 });
    console.log("[fill] 制作方名称");
    return;
  }

  await page.locator(selectors.producerName).waitFor({ state: "visible", timeout: 10000 }).catch(() => undefined);
  if (await page.locator(selectors.producerName).count() > 0) {
      await fillFirstMatchingField(page, selectors.producerName, value, "制作方名称");
  } else {
    console.warn(`[skip] selector not found for 制作方名称: ${selectors.producerName}`);
  }
}

async function fillProductionCost(page: Page, value: number): Promise<void> {
  const textbox = page.getByRole("textbox", { name: "请填写剧目制作成本，该金额需与《成本配置比例情况报告》内容一致" }).first();
  if (await textbox.count() > 0) {
    await textbox.fill(String(value), { timeout: 15000 });
    console.log("[fill] 剧目制作成本");
    return;
  }

  await fillFieldInsideLabeledGroup(page, "剧目制作成本", value, "production-cost", "剧目制作成本");
}

interface VisibleTextCollection {
  texts: string[];
  visibleCount: number;
}

async function readLocatorText(locator: Locator): Promise<string> {
  const text = await locator.innerText().catch(() => "");
  const fallbackText = text || await locator.textContent().catch(() => "") || "";
  return fallbackText.replace(/\s+/g, " ").trim();
}

async function collectVisibleTexts(locator: Locator): Promise<VisibleTextCollection> {
  const texts: string[] = [];
  let visibleCount = 0;
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (!await item.isVisible().catch(() => false)) continue;
    visibleCount += 1;
    const text = await readLocatorText(item);
    if (text) texts.push(text);
  }
  return {
    texts: Array.from(new Set(texts)),
    visibleCount,
  };
}

async function collectBasicInfoValidationErrors(page: Page): Promise<string[]> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const topTips = await collectVisibleTexts(page.locator(".weui-toptips__inner"));
    const fieldWarnings = await collectVisibleTexts(page.locator(".weui-desktop-form__msg_warn"));
    const errors = [
      ...topTips.texts.map((text) => `顶部提示：${text}`),
      ...fieldWarnings.texts.map((text) => `表单提示：${text}`),
    ];

    if (errors.length > 0) return errors;
    if (topTips.visibleCount + fieldWarnings.visibleCount === 0) return [];

    await page.waitForTimeout(300);
  }

  return [];
}

async function assertNoBasicInfoValidationErrors(page: Page): Promise<void> {
  const errors = await collectBasicInfoValidationErrors(page);
  if (errors.length === 0) return;

  const message = `[basic-info-validation-failed] ${errors.join("；")}`;
  console.error(message);
  throw new Error(message);
}

export async function fillBasicInfoStep(page: Page, playletConfig: Config): Promise<void> {
  const { playlet } = playletConfig;
  const dramaName = validateDramaName(playlet.name);
  const dramaSummary = sanitizeDramaText(playlet.summary, "summary");
  const remoteAssetDirectoryName = dramaName;

  await page.goto(postUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  const button = page.getByRole("button", { name: '下一步' }).first();
  await button.waitFor({ state: "visible", timeout: 30000 });

  await fillFirstMatchingField(page, selectors.dramaName, dramaName, "剧目名称");
  await fillFirstMatchingField(page, selectors.summary, dramaSummary, "剧目简介");
  await fillFirstMatchingField(page, selectors.episodeCount, playlet.episodeCount, "总集数");
  await fillFirstMatchingField(page, selectors.previewEpisodeCount, playlet.previewEpisodeCount ?? 1, "试看集数");
  if (playlet.recommendation) {
    await fillFirstMatchingField(page, selectors.recommendation, playlet.recommendation, "推荐语");
  }
  
  const dramaType = playlet.dramaType ?? "数字真人";
  if (!await clickExactText(page, dramaType, "剧目类型")) {
    await selectCheckboxOrRadio(page, `${formGroup(7)} input[type="radio"][value="${dramaTypeValues[dramaType]}"]`, `剧目类型: ${dramaType}`);
  }
  const monetization = playlet.monetization ?? "IAA广告变现";
  await selectCheckboxOrRadio(page, `${formGroup(5)} input[type="radio"][value="${monetizationValues[monetization]}"]`, `变现类型: ${monetization}`);

  if (playlet.aiContent ?? true) {
    // AI内容声明
    await page.locator('.weui-desktop-switch__box').first().click();
  }

  await uploadBySelector(page, `${formGroup(9)} input[type="file"]`, [playlet.posters.main], "剧目海报", resolveFromRoot, 0, undefined, remoteAssetDirectoryName);
  await uploadBySelector(page, `${formGroup(10)} input[type="file"]`, [playlet.posters.promotion], "推广海报", resolveFromRoot, 0, undefined, remoteAssetDirectoryName);

  if (!await clickExactText(page, playlet.submissionIdentity, "提审身份")) {
    await checkRadioByLabel(page, "提审身份", "submission-identity", submissionIdentityValues, playlet.submissionIdentity);
  }
  await fillProducerName(page, playlet.producerName);

  await uploadByLabeledGroupFileInput(
    page,
    ["剧目制作证明材料", "制作证明材料"],
    playlet.copyright.productionProofFiles ?? [],
    "剧目制作证明材料",
    remoteAssetDirectoryName,
  );
  await uploadByLabeledGroupFileInput(
    page,
    ["版权采买&播出授权证明材料", "版权采买及播出授权证明材料", "版权授权证明材料"],
    playlet.copyright.licenseProofFiles ?? [],
    "版权采买&播出授权证明材料",
    remoteAssetDirectoryName,
  );

  const qualificationType = playlet.qualification.type ?? "其他微短剧";
  if (!await clickExactText(page, qualificationType, "剧目资质")) {
    await checkRadioByLabel(page, "剧目资质", "qualification", qualificationValues, qualificationType);
  }

 
  if (playlet.qualification.licenseOrRecordNumber) {
    const filled = await fillInGroupByPlaceholder(
      page,
      "剧目资质",
      "qualification-number",
      "请填写网络剧片发行许可证号或16位备案号",
      playlet.qualification.licenseOrRecordNumber,
      "资质编号",
    );
    if (!filled) {
      await page.locator(selectors.qualificationNumber).waitFor({ state: "visible", timeout: 10000 }).catch(() => undefined);
      await fillFirstMatchingField(page, selectors.qualificationNumber, playlet.qualification.licenseOrRecordNumber, "资质编号");
    }
  }

  await uploadMaterial(
    page,
    ["剧目资质证明材料", "剧目资质", "资质证明材料"],
    playlet.qualification.proofFiles ?? [],
    "剧目资质证明材料",
    remoteAssetDirectoryName,
  );
  if (playlet.productionCost) {
    await fillProductionCost(page, playlet.productionCost.amountWan);
    console.log(`[upload-plan] 剧目制作成本证明材料: ${(playlet.productionCost.proofFiles ?? []).filter(Boolean).length} file(s)`);
    await uploadByLabeledGroupFileInput(
      page,
      ["剧目制作成本证明材料", "剧目制作成本证明文件", "成本配置比例情况报告", "成本证明", "剧目制作成本（单位：万元）", "剧目制作成本"],
      playlet.productionCost.proofFiles ?? [],
      "剧目制作成本证明材料",
      remoteAssetDirectoryName,
    );
  }
  await uploadMaterial(page, "其他材料", playlet.otherMaterials ?? [], "其他材料", remoteAssetDirectoryName);

  await selectCheckboxOrRadio(page, selectors.agreement, "服务须知同意");
  await page.waitForTimeout(2000);
  await button.click();
  await page.waitForTimeout(1000);
  await assertNoBasicInfoValidationErrors(page);
}
