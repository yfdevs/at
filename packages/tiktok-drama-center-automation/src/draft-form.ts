import path from 'node:path';
import type { Locator, Page } from 'playwright';
import { config, logger } from './config.js';
import type { EpisodeFile } from './media.js';
import type { Scheme } from './scheme.js';

const videoUploadTimeoutMs = 30 * 60_000;
const videoUploadPollMs = 5_000;

export async function waitForDraftPage(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await waitForLoginIfNeeded(page);
  try {
    await page.getByText('基础信息').first().waitFor({ timeout: 20_000 });
  } catch {
    await waitForLoginIfNeeded(page);
    logger.warn('draft form not visible; log in in the opened browser window');
    await page.getByText('基础信息').first().waitFor({ timeout: 300_000 });
  }
}

async function waitForLoginIfNeeded(page: Page) {
  if (!isLoginPage(page.url())) return;
  logger.warn({ loginUrl: config.loginUrl }, 'login required; waiting for login before loading scheme');
  await page.waitForURL(url => !isLoginPage(url.toString()), { timeout: 300_000 });
  await page.goto(config.draftUrl, { waitUntil: 'domcontentloaded' });
}

function isLoginPage(url: string) {
  try {
    return new URL(url).pathname === new URL(config.loginUrl).pathname;
  } catch {
    return false;
  }
}

export async function fillDraft(page: Page, scheme: Scheme, coverFile: string, videos: EpisodeFile[]) {
  await selectContract(page, scheme.contractText);
  await page.getByPlaceholder('输入剧集名称').fill(scheme.title);
  await page.getByPlaceholder('概述你的内容，添加精彩细节吸引更多观众').fill(scheme.description);
  await assertNoFormErrors(page);

  await uploadCover(page, coverFile);
  let videoUploadError: unknown;
  const videoFiles = videos.map(v => v.file);
  // await startVideoUpload(page, videoFiles);
  // const videoUpload = monitorVideoUpload(page, videoFiles).catch((error: unknown) => {
  //   videoUploadError = error;
  // });
  const videoUpload = Promise.resolve();

  await selectFieldCombobox(page, '目标观众', '选择内容主要面向的目标人群', scheme.targetAudience);
  await selectThemeOptions(page, scheme.themes);
  await selectFieldCombobox(page, '源语言', '请选择剧集的源语言', scheme.sourceLanguage);
  await assertFieldValue(page, '源语言', scheme.sourceLanguage);
  await page.getByPlaceholder('输入数字').first().fill(String(scheme.episodeCount));
  await selectFieldCombobox(page, '是否 AI 短剧', '请选择是否 AI 短剧', scheme.isAiDrama);

  await setSwitchNearText(page, '自动挂载锚点', scheme.autoMountAnchor);
  await confirmCopyrightChecklist(page);
  await setPublishMode(page, scheme);
  await assertNoFormErrors(page);
  await setSwitchNearText(page, '托管模式', scheme.hostingMode);
  await fillPricing(page, scheme);
  await addActors(page, scheme.actors);
  await assertNoFormErrors(page);
  await videoUpload;
  if (videoUploadError) throw videoUploadError;

  logger.info({ taskId: scheme.id, fileCount: videos.length }, 'form filled');
}

async function selectContract(page: Page, contractText?: string) {
  await openFieldCombobox(page, '关联合同', '请选择合同');
  const wanted = contractText ?? '类型: 通用合同';
  if (await clickPopupOption(page, wanted, { loose: true, optional: true })) return;
  if (contractText) {
    await page.keyboard.type(contractText);
    if (await clickPopupOption(page, contractText, { loose: true, optional: true })) return;
    throw new Error(`contract not found: ${contractText}`);
  }
  await page.keyboard.press('Escape').catch(() => {});
}

async function selectFieldCombobox(page: Page, label: string, controlText: string, optionText: string, close = true) {
  await openFieldCombobox(page, label, controlText);
  await clickPopupOption(page, optionText);
  if (close) await page.keyboard.press('Escape').catch(() => {});
}

async function openFieldCombobox(page: Page, label: string, fallbackText: string) {
  const byLabel = page.locator(`xpath=//*[normalize-space()="${label}"]/following::*[@role="combobox"][1]`);
  if (await byLabel.count()) {
    await byLabel.first().click();
    return;
  }
  const locator = page.getByRole('combobox').filter({ hasText: fallbackText }).first();
  if (await locator.count()) {
    await locator.click();
    return;
  }
  await page.getByText(fallbackText, { exact: true }).click();
}

async function clickPopupOption(page: Page, optionText: string, opts: { loose?: boolean; optional?: boolean } = {}) {
  const option = opts.loose
    ? page.getByRole('option').filter({ hasText: optionText }).first()
    : page.getByRole('option', { name: optionText, exact: true }).first();
  if (await option.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await option.click();
    return true;
  }

  const cssOption = page.locator('[role="option"], .semi-select-option, [class*="option"]').filter({ hasText: optionText }).first();
  const clicked = await cssOption.click({ timeout: 3_000 }).then(() => true, () => false);
  if (!clicked && !opts.optional) throw new Error(`option not found: ${optionText}`);
  return clicked;
}

async function selectThemeOptions(page: Page, themes: string[]) {
  if (!themes.length) return;
  await openFieldCombobox(page, '题材类型', '选择剧集的题材标签');
  for (const theme of themes) await clickPopupOption(page, theme);
  await page.keyboard.press('Escape').catch(() => {});
}

async function setPublishMode(page: Page, scheme: Scheme) {
  const label = scheme.publishMode;
  const radioText = page.locator(`xpath=//*[normalize-space()="发布方式"]/following::*[normalize-space()="${label}"][1]`);
  await radioText.click({ force: true });
  if (scheme.publishMode === '定时发布') {
    if (!scheme.scheduledAt) throw new Error('scheduledAt is required when publishMode=定时发布');
    await page.getByPlaceholder('选择发布时间').fill(scheme.scheduledAt);
  }
}

async function setSwitchNearText(page: Page, text: string, enabled: boolean) {
  const switchInput = page.locator(`xpath=//*[contains(normalize-space(), "${text}")]/following::input[@role="switch"][1]`);
  if (!(await switchInput.count())) return;
  const checked = await switchInput.first().isChecked();
  if (checked !== enabled) await switchInput.first().click({ force: true });
}

async function fillPricing(page: Page, scheme: Scheme) {
  if (scheme.freePreviewEpisodes != null) {
    const freeInput = page.getByRole('textbox', { name: '个人页剧集展示集数' });
    if (await freeInput.count()) await freeInput.fill(String(scheme.freePreviewEpisodes));
  }
  if (scheme.paidFreePreviewEpisodes != null) {
    const paidInput = page.getByRole('textbox', { name: '免费预览集数', exact: true });
    if (await paidInput.count()) await paidInput.fill(String(scheme.paidFreePreviewEpisodes));
  }
  if (scheme.pricePerEpisode) {
    await openFieldCombobox(page, '预期全集价格设置', '预期全集价格设置');
    await clickPopupOption(page, scheme.pricePerEpisode, { loose: true });
    await page.keyboard.press('Escape').catch(() => {});
  }
  if (scheme.purchaseMode) {
    logger.warn('purchaseMode skipped: this page version no longer shows purchase radios in 商业模式');
  }
}

async function addActors(page: Page, actors: string[]) {
  for (const actor of actors) {
    await page.getByRole('button', { name: '添加演员' }).last().click();
    const actorDialog = page.getByRole('dialog').filter({ hasText: '添加演员' }).last();
    const input = page.getByPlaceholder('输入名字选择或创建');
    await input.click();
    await input.fill(actor);
    await clickPopupOption(page, actor, { loose: true });
    await actorDialog.getByRole('button', { name: '确认' }).click();
    await actorDialog.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
  }
}

async function confirmCopyrightChecklist(page: Page) {
  const field = page.locator('.semi-form-field').filter({ hasText: '版权内容自查清单' }).last();
  const checkbox = field.locator('input[type="checkbox"]').first();
  if (await checkbox.isChecked()) return;

  await field.scrollIntoViewIfNeeded();
  await field.click({ force: true });

  const drawer = page.locator('[role="dialog"], .semi-sidesheet').filter({ hasText: '版权内容自查清单' }).last();
  if (!(await drawer.isVisible({ timeout: 5_000 }).catch(() => false))) {
    throw new Error('copyright checklist drawer did not open');
  }
  const boxes = drawer.locator('input[type="checkbox"]');
  for (let i = 0; i < await boxes.count(); i++) {
    await checkSemiCheckbox(boxes.nth(i));
  }
  const uncheckedCount = await drawer.locator('input[type="checkbox"]:not(:checked)').count();
  if (uncheckedCount) throw new Error(`copyright checklist has ${uncheckedCount} unchecked items`);
  await drawer.getByRole('button', { name: '同意', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await drawer.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});

  if (!(await checkbox.isChecked())) throw new Error('copyright commitment checkbox is not checked');
}

async function checkSemiCheckbox(input: Locator) {
  if (await input.isChecked()) return;
  await input.evaluate((element: HTMLInputElement) => {
    element.click();
    if (!element.checked) {
      element.checked = true;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  if (!(await input.isChecked())) throw new Error('checkbox was not checked');
}

async function uploadCover(page: Page, file: string) {
  await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles(file);
  await page.getByText('替换封面').waitFor({ timeout: 30_000 });
}

async function startVideoUpload(page: Page, files: string[]) {
  await page.locator('input[type="file"][accept=".mp4,.mov"][multiple]').first().setInputFiles(files);
  logger.info({ fileCount: files.length }, 'video upload started');
}

async function monitorVideoUpload(page: Page, files: string[]) {
  const deadline = Date.now() + videoUploadTimeoutMs;
  const expectedNames = files.map(file => path.basename(file, path.extname(file)));
  let lastProgress = '';

  while (Date.now() < deadline) {
    const failed = await page.getByText('上传失败', { exact: true }).count();
    if (failed) throw new Error(`video upload failed: ${failed} file(s)`);

    const uploading = await page.getByText('Uploading...', { exact: true }).count();
    const progress = await page.locator('span').filter({ hasText: /^\d+%$/ }).allTextContents();
    const visibleNames = await Promise.all(
      expectedNames.map(name => page.getByText(name).first().isVisible().catch(() => false))
    );
    const progressText = progress.join(', ');

    if (progressText && progressText !== lastProgress) {
      lastProgress = progressText;
      logger.info({ progress: progressText }, 'video upload progress');
    }
    if (visibleNames.every(Boolean) && uploading === 0 && progress.length === 0) {
      logger.info({ fileCount: files.length }, 'video upload finished');
      return;
    }
    await page.waitForTimeout(videoUploadPollMs);
  }

  throw new Error(`video upload timed out after ${videoUploadTimeoutMs}ms`);
}

async function assertFieldValue(page: Page, label: string, expected: string) {
  const selected = page.locator(`xpath=//*[normalize-space()="${label}"]/following::*[@role="combobox"][1]`).filter({ hasText: expected }).first();
  await selected.waitFor({ timeout: 5_000 }).catch(() => {
    throw new Error(`${label} not selected: ${expected}`);
  });
}

async function assertNoFormErrors(page: Page) {
  const errors = await page.locator('.semi-form-field-error-message:visible').allTextContents();
  const messages = errors.map(text => text.trim()).filter(Boolean);
  if (messages.length) {
    logger.error({ formErrors: messages }, 'form validation failed');
    throw new Error(`form validation failed: ${messages.join(' | ')}`);
  }
}
