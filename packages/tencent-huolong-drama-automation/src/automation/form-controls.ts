import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { tencentHuolongThemeOptionId } from "../shared/constants.js";
import { log } from "../shared/logger.js";
import type {
  ClaimedTencentHuolongDramaTask,
  TencentHuolongRuntimeOptions,
  TencentHuolongTheme,
} from "../shared/types.js";
import type { TencentHuolongCoverFiles } from "../shared/covers.js";

async function clickFieldOption(page: Page, fieldName: string, text: string) {
  const option = page.locator(`[data-field-name="${fieldName}"]`).getByText(text, { exact: true }).filter({ visible: true });
  await option.first().click({ timeout: 15_000 });
}

async function waitForChecked(page: Page, input: Locator, timeout = 2_000) {
  const deadline = Date.now() + timeout;
  do {
    if (await input.isChecked().catch(() => false)) return true;
    await page.waitForTimeout(50);
  } while (Date.now() < deadline);
  return input.isChecked().catch(() => false);
}

async function checkCustomControl(page: Page, input: Locator, description: string) {
  await input.waitFor({ state: "attached", timeout: 15_000 });
  if (await input.isChecked().catch(() => false)) return;

  const targets = [
    input.locator("xpath=ancestor::label[1]"),
    input.locator("xpath=.."),
    input.locator('xpath=ancestor::*[@role="radio" or @role="checkbox"][1]'),
  ];
  for (const target of targets) {
    if (await target.count() === 0 || !await target.isVisible().catch(() => false)) continue;
    await target.click({ timeout: 5_000 }).catch(() => undefined);
    if (await waitForChecked(page, input)) return;
  }

  await input.evaluate((element) => (element as HTMLElement).click()).catch(() => undefined);
  if (await waitForChecked(page, input)) return;
  throw new Error(`TENCENT_HUOLONG_DRAMA_CONTROL_NOT_SELECTED: ${description}`);
}

async function checkNamedRadio(page: Page, name: string, index: number) {
  const radio = page.locator(`input[type="radio"][name="${name}"]`).nth(index);
  await checkCustomControl(page, radio, `${name}[${index}]`);
}

async function checkRadioByFieldName(page: Page, fieldName: string, index: number) {
  const radio = page.locator(`[data-field-name="${fieldName}"] input[type="radio"]`).nth(index);
  await checkCustomControl(page, radio, `${fieldName}[${index}]`);
}

async function fillField(page: Page, fieldName: string, value: string) {
  const input = page.locator(`[data-field-name="${fieldName}"] input, [data-field-name="${fieldName}"] textarea`).first();
  await input.waitFor({ state: "visible", timeout: 20_000 });
  await input.fill(value);
}

async function readThemeSelection(select: Locator, trigger: Locator) {
  const [value, label] = await Promise.all([
    select.getAttribute("data-value").catch(() => null),
    trigger.textContent().then((text) => text?.trim() ?? "").catch(() => ""),
  ]);
  return { label, value };
}

async function themeSelected(
  select: Locator,
  trigger: Locator,
  optionId: string,
  theme: TencentHuolongTheme,
) {
  const selection = await readThemeSelection(select, trigger);
  return selection.value === optionId || selection.label === theme;
}

async function waitForThemeSelected(
  page: Page,
  select: Locator,
  trigger: Locator,
  optionId: string,
  theme: TencentHuolongTheme,
  timeout = 3_000,
) {
  const deadline = Date.now() + timeout;
  do {
    if (await themeSelected(select, trigger, optionId, theme)) return true;
    await page.waitForTimeout(50);
  } while (Date.now() < deadline);
  return themeSelected(select, trigger, optionId, theme);
}

async function themeDropdownOpen(optionList: Locator) {
  return optionList.evaluate((element) => {
    const node = element as HTMLElement;
    const style = window.getComputedStyle(node);
    return node.getBoundingClientRect().height > 0
      && style.display !== "none"
      && style.visibility !== "hidden";
  }).catch(() => false);
}

async function waitForThemeDropdownClosed(page: Page, optionList: Locator, timeout = 2_000) {
  const deadline = Date.now() + timeout;
  do {
    if (!await themeDropdownOpen(optionList)) return true;
    await page.waitForTimeout(50);
  } while (Date.now() < deadline);
  return !await themeDropdownOpen(optionList);
}

async function waitForThemeDropdownOpen(page: Page, optionList: Locator, timeout = 2_000) {
  const deadline = Date.now() + timeout;
  do {
    if (await themeDropdownOpen(optionList)) return true;
    await page.waitForTimeout(50);
  } while (Date.now() < deadline);
  return themeDropdownOpen(optionList);
}

async function chooseTheme(
  page: Page,
  theme: TencentHuolongTheme,
  options: TencentHuolongRuntimeOptions,
) {
  const root = page.locator('[data-field-name="micro_comic_theme"]');
  const select = root.locator('div[class*="_select_"]').first();
  const trigger = root.locator('div[class*="_input_"]').first();
  const optionList = root.locator('div[class*="_optionList_"]').first();
  const optionId = tencentHuolongThemeOptionId[theme];
  await trigger.waitFor({ state: "visible", timeout: 15_000 });
  if (await themeSelected(select, trigger, optionId, theme)) {
    log(options, `[tencent-huolong-drama] 题材类型已是：${theme}`);
    return;
  }

  await trigger.click({ timeout: 10_000 });
  if (!await waitForThemeDropdownOpen(page, optionList)) {
    await trigger.click({ force: true, timeout: 10_000 });
  }
  if (!await waitForThemeDropdownOpen(page, optionList)) {
    throw new Error("TENCENT_HUOLONG_DRAMA_THEME_DROPDOWN_NOT_OPENED");
  }

  const index = Object.keys(tencentHuolongThemeOptionId).indexOf(theme);
  await optionList.evaluate((element, scrollTop) => {
    element.scrollTop = scrollTop;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  }, Math.max(0, index - 2) * 40);
  await page.waitForTimeout(150);

  const option = root.locator(`[data-value="${optionId}"]`).first();
  await option.waitFor({ state: "visible", timeout: 10_000 });
  const viewportScroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  await option.click({ timeout: 10_000 });
  await page.evaluate(({ x, y }) => window.scrollTo(x, y), viewportScroll);

  if (!await waitForThemeSelected(page, select, trigger, optionId, theme)) {
    if (!await themeDropdownOpen(optionList)) {
      await trigger.click({ timeout: 10_000 });
      await waitForThemeDropdownOpen(page, optionList);
    }
    await option.waitFor({ state: "visible", timeout: 10_000 });
    await option.dispatchEvent("pointerdown", { button: 0 });
    await option.dispatchEvent("mousedown", { button: 0 });
    await option.dispatchEvent("pointerup", { button: 0 });
    await option.dispatchEvent("mouseup", { button: 0 });
    await option.dispatchEvent("click", { button: 0 });
  }
  if (!await waitForThemeSelected(page, select, trigger, optionId, theme)) {
    const selection = await readThemeSelection(select, trigger);
    throw new Error(
      `TENCENT_HUOLONG_DRAMA_THEME_NOT_SELECTED: ${theme}; actualValue=${selection.value ?? ""}; actualLabel=${selection.label}`,
    );
  }

  // Selecting an option starts a collapse animation. Do not click the trigger
  // immediately here, otherwise it can reopen the dropdown while it is closing.
  let closed = await waitForThemeDropdownClosed(page, optionList);
  if (!closed) {
    await page.keyboard.press("Escape");
    closed = await waitForThemeDropdownClosed(page, optionList, 1_000);
  }
  if (!closed) {
    // A real click outside is required by this React select. Synthetic DOM
    // events leave the select in its `_focused_` state on some page versions.
    const triggerBox = await trigger.boundingBox();
    if (triggerBox) {
      await page.mouse.click(
        Math.max(2, triggerBox.x - 12),
        Math.max(2, triggerBox.y + 2),
      );
    }
    closed = await waitForThemeDropdownClosed(page, optionList, 1_000);
  }
  if (!closed) {
    await trigger.click({ force: true, timeout: 10_000 });
    closed = await waitForThemeDropdownClosed(page, optionList, 2_000);
  }
  if (!closed) {
    // The selected data-value is authoritative. Some page versions keep the
    // animated option container measurable after it has stopped accepting input.
    log(options, `[tencent-huolong-drama] 题材类型已选中，但下拉容器仍有残留：${theme}`);
    return;
  }
  log(options, `[tencent-huolong-drama] 题材类型已选择并收起：${theme}`);
}

async function confirmCropIfPresent(page: Page, timeout = 15_000) {
  const platformConfirm = page.locator('button[dt-mpid="上传封面确定"]');
  const textConfirm = page.getByRole("button", {
    name: /^(?:使用|确定|确认|完成|保存)$/u,
  });
  const confirm = platformConfirm.or(textConfirm).filter({ visible: true }).last();
  const appeared = await confirm.waitFor({ state: "visible", timeout })
    .then(() => true, () => false);
  if (!appeared) return false;

  const dialog = confirm.locator('xpath=ancestor::*[@role="dialog"][1]');
  await confirm.click({ timeout: 15_000 });
  await confirm.waitFor({ state: "hidden", timeout: 30_000 });
  if (await dialog.count() > 0) {
    await dialog.waitFor({ state: "hidden", timeout: 30_000 }).catch(() => undefined);
  }
  return true;
}

type UploadCoverOptions = {
  automaticExpansionSelector?: string;
  description: string;
  file: string;
  inputIndex: number;
  inputSelectors?: string[];
  uploadDialogTitle?: RegExp;
  uploadDialogInputSelectors?: string[];
  triggerSelectors?: string[];
  labels: string[];
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function openCoverFileChooser(
  page: Page,
  trigger: Locator,
  description: string,
) {
  const attempt = async () => {
    const results = await Promise.allSettled([
      page.waitForEvent("filechooser", { timeout: 15_000 }),
      trigger.click({ timeout: 15_000 }),
    ]);
    if (results[0].status === "fulfilled") return results[0].value;
    const clickError = results[1].status === "rejected" ? `; click=${errorMessage(results[1].reason)}` : "";
    throw new Error(`${errorMessage(results[0].reason)}${clickError}`);
  };

  try {
    return await attempt();
  } catch (firstError) {
    const recoveredDialog = await confirmCropIfPresent(page, 1_000);
    if (!recoveredDialog) {
      throw new Error(
        `TENCENT_HUOLONG_DRAMA_FILE_CHOOSER_NOT_OPENED: ${description}; ${errorMessage(firstError)}`,
      );
    }
    return await attempt().catch((retryError) => {
      throw new Error(
        `TENCENT_HUOLONG_DRAMA_FILE_CHOOSER_NOT_OPENED_AFTER_CROP_RECOVERY: ${description}; ${errorMessage(retryError)}`,
      );
    });
  }
}

async function uploadCoverThroughDialog(
  page: Page,
  trigger: Locator,
  options: UploadCoverOptions,
) {
  const dialogTitle = options.uploadDialogTitle;
  if (!dialogTitle) return false;

  const dialog = page.locator('[role="dialog"][aria-modal="true"], .ReactModal__Content')
    .filter({ hasText: dialogTitle, visible: true })
    .last();
  if (!await dialog.isVisible().catch(() => false)) {
    await trigger.click({ timeout: 15_000 });
    await dialog.waitFor({ state: "visible", timeout: 15_000 });
  }

  let interrupted = false;
  for (const label of ["中断扩图", "停止扩图", "取消扩图"]) {
    const interrupt = dialog.getByRole("button", { name: label, exact: true }).filter({ visible: true });
    if (await interrupt.count() > 0 && await interrupt.first().isEnabled()) {
      await interrupt.first().click({ timeout: 15_000 });
      interrupted = true;
      break;
    }
  }
  if (interrupted && !await dialog.isVisible().catch(() => false)) {
    await trigger.click({ timeout: 15_000 });
    await dialog.waitFor({ state: "visible", timeout: 15_000 });
  }

  const uploadTab = dialog.getByRole("button", { name: "上传封面", exact: true }).filter({ visible: true });
  await uploadTab.waitFor({ state: "visible", timeout: 15_000 });
  await uploadTab.click({ timeout: 15_000 });
  await dialog.locator('div[class*="_uploadPanel_"]')
    .filter({ visible: true })
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });

  const preciseInput = (options.uploadDialogInputSelectors ?? [])
    .map((selector) => dialog.locator(selector))
    .reduce((combined, input) => combined ? combined.or(input) : input, null as Locator | null);
  const input = (preciseInput ?? dialog.locator('input[type="file"]:not([id$="_ai"])')).first();
  await input.waitFor({ state: "attached", timeout: 15_000 });
  await input.setInputFiles(options.file, { timeout: 60_000 });
  await confirmCropIfPresent(page);
  await dialog.waitFor({ state: "hidden", timeout: 30_000 });
  return true;
}

async function uploadCover(
  page: Page,
  options: UploadCoverOptions,
  runtimeOptions: TencentHuolongRuntimeOptions,
) {
  await confirmCropIfPresent(page, 250);
  log(runtimeOptions, `[tencent-huolong-drama] 开始上传${options.description}`);

  if (options.automaticExpansionSelector) {
    const expansionRoot = page.locator(options.automaticExpansionSelector)
      .filter({ visible: true })
      .first();
    const expanding = expansionRoot
      .getByText("AI扩图中...", { exact: false })
      .filter({ visible: true });
    if (await expanding.count() > 0) {
      log(
        runtimeOptions,
        `[tencent-huolong-drama] 检测到平台正在自动扩图，立即切换到上传封面并用本地${options.description}覆盖`,
      );
      const expansionTrigger = expansionRoot.locator('div[class*="_aiExpandingTrigger_"]').first();
      if (await uploadCoverThroughDialog(page, expansionTrigger, options)) {
        log(runtimeOptions, `[tencent-huolong-drama] ${options.description}已覆盖平台AI扩图`);
        return;
      }
    }
  }

  for (const selector of options.inputSelectors ?? []) {
    const input = page.locator(selector).first();
    if (await input.count() > 0) {
      await input.setInputFiles(options.file);
      await confirmCropIfPresent(page);
      log(runtimeOptions, `[tencent-huolong-drama] ${options.description}上传并确认完成`);
      return;
    }
  }

  for (const selector of options.triggerSelectors ?? []) {
    const trigger = page.locator(selector).filter({ visible: true }).first();
    const appeared = await trigger.waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true, () => false);
    if (!appeared) continue;
    if (await uploadCoverThroughDialog(page, trigger, options)) {
      log(runtimeOptions, `[tencent-huolong-drama] ${options.description}上传并确认完成`);
      return;
    }
    const chooser = await openCoverFileChooser(page, trigger, options.description);
    await chooser.setFiles(options.file);
    await confirmCropIfPresent(page);
    log(runtimeOptions, `[tencent-huolong-drama] ${options.description}上传并确认完成`);
    return;
  }

  for (const label of options.labels) {
    const trigger = page.getByText(label, { exact: false }).filter({ visible: true }).first();
    if (await trigger.count() === 0) continue;

    if (await uploadCoverThroughDialog(page, trigger, options)) {
      log(runtimeOptions, `[tencent-huolong-drama] ${options.description}上传并确认完成`);
      return;
    }

    const relatedInput = trigger.locator(
      'xpath=ancestor-or-self::*[.//input[@type="file"]][1]//input[@type="file"]',
    ).first();
    if (await relatedInput.count() > 0) {
      await relatedInput.setInputFiles(options.file);
      await confirmCropIfPresent(page);
      log(runtimeOptions, `[tencent-huolong-drama] ${options.description}上传并确认完成`);
      return;
    }

    const chooser = await openCoverFileChooser(page, trigger, options.description);
    await chooser.setFiles(options.file);
    await confirmCropIfPresent(page);
    log(runtimeOptions, `[tencent-huolong-drama] ${options.description}上传并确认完成`);
    return;
  }

  const imageInputs = page.locator([
    'input[type="file"][accept*="image"]',
    'input[type="file"][accept*=".jpg"]',
    'input[type="file"][accept*=".jpeg"]',
    'input[type="file"][accept*=".png"]',
  ].join(","));
  if (options.inputIndex < 2 && await imageInputs.count() > options.inputIndex) {
    await imageInputs.nth(options.inputIndex).setInputFiles(options.file);
    await confirmCropIfPresent(page);
    log(runtimeOptions, `[tencent-huolong-drama] ${options.description}上传并确认完成`);
    return;
  }

  throw new Error(`TENCENT_HUOLONG_DRAMA_UPLOAD_CONTROL_NOT_FOUND: ${options.description}`);
}

async function resolveFile(reference: string, options: TencentHuolongRuntimeOptions) {
  if (!/^https?:\/\//i.test(reference)) return reference;
  if (!options.assetDownloadDir) throw new Error("TENCENT_HUOLONG_DRAMA_ASSET_DIR_REQUIRED");
  const url = new URL(reference);
  if (url.hostname.endsWith(".invalid")) {
    throw new Error(`TENCENT_HUOLONG_DRAMA_MOCK_TASK_FILE_NOT_CONFIGURED: ${url.pathname}`);
  }
  const response = await fetch(reference, {
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  }).catch((error) => {
    throw new Error(
      `TENCENT_HUOLONG_DRAMA_ASSET_DOWNLOAD_FAILED: ${reference}; ${errorMessage(error)}`,
    );
  });
  if (!response.ok) throw new Error(`TENCENT_HUOLONG_DRAMA_ASSET_DOWNLOAD_FAILED: HTTP ${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  const extension = path.extname(new URL(reference).pathname) || ({
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
  } as Record<string, string>)[contentType ?? ""] || ".bin";
  const file = path.join(
    options.assetDownloadDir,
    "task-files",
    `${createHash("sha1").update(reference).digest("hex").slice(0, 16)}${extension}`,
  );
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

async function uploadFilesByFieldName(
  page: Page,
  fieldName: string,
  description: string,
  references: string[],
  options: TencentHuolongRuntimeOptions,
) {
  const localFiles = await Promise.all(references.map((reference) => resolveFile(reference, options)));
  const field = page.locator(`[data-field-name="${fieldName}"]`).first();
  const input = field.locator('input[type="file"]').first();
  await input.waitFor({ state: "attached", timeout: 15_000 });
  const selectedFiles = await input.getAttribute("multiple") === null ? localFiles.slice(0, 1) : localFiles;
  await input.setInputFiles(selectedFiles);

  const pendingSpinners = field.locator('span[class*="_spin_"]').filter({ visible: true });
  const deadline = Date.now() + 5 * 60_000;
  let lastPendingCount = -1;
  let quietSince: number | null = null;
  while (Date.now() < deadline) {
    const pendingCount = await pendingSpinners.count();
    if (pendingCount !== lastPendingCount) {
      log(
        options,
        `[tencent-huolong-drama] ${description}上传状态：上传中=${pendingCount}`,
      );
      lastPendingCount = pendingCount;
    }
    if (pendingCount === 0) {
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= 750) {
        log(options, `[tencent-huolong-drama] ${description}已全部上传完成`);
        return;
      }
    } else {
      quietSince = null;
    }
    await page.waitForTimeout(250);
  }

  const [pendingCount, fieldText] = await Promise.all([
    pendingSpinners.count(),
    field.innerText().catch(() => ""),
  ]);
  throw new Error(
    `TENCENT_HUOLONG_DRAMA_DOCUMENT_UPLOAD_TIMEOUT: ${description}; `
      + `pending=${pendingCount}`
      + `${fieldText ? `; detail=${fieldText.replace(/\s+/g, " ").trim()}` : ""}`,
  );
}

export async function fillTencentHuolongFirstPage(
  page: Page,
  task: ClaimedTencentHuolongDramaTask,
  subtitle: string,
  covers: TencentHuolongCoverFiles,
  options: TencentHuolongRuntimeOptions,
) {
  await fillField(page, "user_title", task.playlet.title);
  await fillField(page, "second_title", subtitle);
  await fillField(page, "user_description", task.playlet.summary);

  await uploadCover(page, {
    description: "横版封面",
    file: covers.landscape,
    inputIndex: 0,
    inputSelectors: ["input#uploadHorCoverButton"],
    labels: ["上传横版图片", "上传横版封面"],
  }, options);
  await uploadCover(page, {
    description: "竖版封面",
    file: covers.portrait,
    inputIndex: 1,
    inputSelectors: ["input#uploadVerCoverButton"],
    labels: ["上传竖版图片", "上传竖版封面"],
  }, options);
  await uploadCover(page, {
    description: "榜单封面",
    file: covers.ranking,
    inputIndex: 2,
    inputSelectors: [
      "input#uploadRankCoverButton",
      "input#uploadRankingCoverButton",
      '[data-field-name="ranking_cover"] input[type="file"]',
    ],
    uploadDialogTitle: /榜单封面图/u,
    uploadDialogInputSelectors: ["input#uploadRanklistCoverButton"],
    triggerSelectors: ['[dt-mpid="cover_ranklist_pick"]'],
    labels: ["上传榜单封面图", "上传榜单封面", "榜单封面图", "榜单封面"],
  }, options);
  await uploadCover(page, {
    automaticExpansionSelector: 'div[class*="_uploadCoverButtonWrap_"][style*="width: 178px"]',
    description: "横版卡片图",
    file: covers.card,
    inputIndex: 3,
    inputSelectors: [
      "input#uploadHorCardButton",
      "input#uploadCardCoverButton",
      '[data-field-name="horizontal_card"] input[type="file"]',
    ],
    uploadDialogTitle: /横版卡片(?:图|封面)/u,
    uploadDialogInputSelectors: ["input#uploadFiveFourCoverButton"],
    triggerSelectors: [
      'div[class*="_uploadCoverButtonWrap_"][style*="width: 178px"] > div[class*="_button_"]',
      '[dt-mpid="cover_5_4_pick"]',
      'div[class*="_uploadCoverButtonWrap_"]:has-text("上传横版卡片图") [class*="_button_"]',
    ],
    labels: ["上传横版卡片图", "上传横版卡片", "横版卡片图", "横版卡片"],
  }, options);

  await checkNamedRadio(page, "is_ai_real_person_short_drama", task.playlet.isAiRealPersonShortDrama === "是" ? 0 : 1);
  await clickFieldOption(page, "micro_series_mode", "非独家首播");
  await clickFieldOption(page, "distribution_platform", "火龙漫剧+腾讯视频");
  await clickFieldOption(page, "kairos_pay_mode", "免费");
  await clickFieldOption(page, "pay_model", "免费");
  await chooseTheme(page, task.playlet.themeType, options);

  await checkNamedRadio(page, "is_end_update", 0);
  await page.locator('[data-field-name="total_episode"] input[type="number"]').fill(String(task.playlet.episodeCount));
  await page.locator('[data-field-name="micro_series_duration"] input[type="number"]').fill("1");
  await checkNamedRadio(page, "is_adapted_from_ip", 1);
  await page.locator('[data-field-name="budget_str"] input[type="number"]').fill("1");
  await checkNamedRadio(page, "is_cp_key_record", 1);
  await checkRadioByFieldName(page, "has_own_copyright", 1);

  await uploadFilesByFieldName(
    page,
    "ohter_micro_cover_costing",
    "成本配置分析（承诺函）",
    task.playlet.costAnalysisFiles,
    options,
  );
  await uploadFilesByFieldName(
    page,
    "rights_supplementary_files",
    "版权证明文件",
    task.playlet.copyrightProofFiles,
    options,
  );
  await uploadFilesByFieldName(
    page,
    "personal_commitment_letter_file",
    "不侵权承诺函",
    task.playlet.nonInfringementCommitmentFiles,
    options,
  );
  await uploadFilesByFieldName(
    page,
    "source_file_screenshot_files",
    "生成过程和工程文件截图",
    task.playlet.productionProcessFiles,
    options,
  );

  await checkRadioByFieldName(page, "auth_duration", 0);
  await checkRadioByFieldName(page, "aboard_area_limit", 2);
  const broadcastRight = page.locator('[data-field-name="granted_rights"] input[type="checkbox"][name="广播权"]');
  await checkCustomControl(page, broadcastRight, "granted_rights=广播权");
  log(options, "[tencent-huolong-drama] 首屏全部必填项已填写");
}

async function confirmAuthorizationContractIfPresent(
  page: Page,
  options: TencentHuolongRuntimeOptions,
) {
  const dialog = page.locator('[role="dialog"][aria-modal="true"]')
    .filter({ hasText: "确认合同", visible: true })
    .last();
  const appeared = await dialog.waitFor({ state: "visible", timeout: 8_000 })
    .then(() => true, () => false);
  if (!appeared) return false;

  log(options, "[tencent-huolong-drama] 检测到确认合同弹窗");
  const agreement = dialog.locator('input[type="checkbox"]').first();
  await checkCustomControl(page, agreement, "确认同意授权合作合同");

  const confirm = dialog.getByRole("button", { name: /^(?:确认|确定)$/u })
    .filter({ visible: true })
    .last();
  await confirm.waitFor({ state: "visible", timeout: 10_000 });
  const enableDeadline = Date.now() + 10_000;
  while (!await confirm.isEnabled().catch(() => false) && Date.now() < enableDeadline) {
    await page.waitForTimeout(100);
  }
  if (!await agreement.isChecked().catch(() => false) || !await confirm.isEnabled().catch(() => false)) {
    throw new Error("TENCENT_HUOLONG_DRAMA_CONTRACT_AGREEMENT_NOT_CONFIRMED");
  }

  await confirm.click({ timeout: 15_000 });
  await dialog.waitFor({ state: "hidden", timeout: 60_000 });
  log(options, "[tencent-huolong-drama] 授权合作合同已确认");
  return true;
}

export async function submitAndOpenVideoStep(page: Page, options: TencentHuolongRuntimeOptions) {
  const button = page.getByRole("button", { name: /^提交并添加(?:视频|合同)$/u }).filter({ visible: true });
  await button.click({ timeout: 20_000 });
  await confirmAuthorizationContractIfPresent(page, options);
  await page.waitForTimeout(500);
  const errors = await page.locator('[class*="error"],[role="alert"]').filter({ visible: true }).allInnerTexts();
  const message = errors.map((text) => text.replace(/\s+/g, " ").trim()).filter(Boolean).join("；");
  if (message) throw new Error(`TENCENT_HUOLONG_DRAMA_FORM_INVALID: ${message}`);
  const localUpload = page.getByText("本地上传", { exact: true }).filter({ visible: true });
  if (await localUpload.count() > 0) await localUpload.first().click();
  await page.locator('input[type="file"][accept*="video"],input[type="file"][accept*="mp4"]').first()
    .waitFor({ state: "attached", timeout: 60_000 });
  log(options, "[tencent-huolong-drama] 已进入添加视频页面");
}

export async function submitTencentHuolongVideos(page: Page, options: TencentHuolongRuntimeOptions) {
  const postSubmitSettleMs = 10_000;
  const submit = page.getByRole("button", { name: "提交", exact: true }).filter({ visible: true });
  await submit.last().click({ timeout: 30_000 });
  let finalSubmitClickedAt = Date.now();

  const continueSubmit = page.getByRole("button", { name: "继续提交", exact: true }).filter({ visible: true });
  await continueSubmit.last().waitFor({ state: "visible", timeout: 3_000 })
    .then(async () => {
      await continueSubmit.last().click();
      finalSubmitClickedAt = Date.now();
    })
    .catch(() => undefined);

  await Promise.race([
    page.waitForURL((url) => !url.pathname.startsWith("/kairos/publish/cid/vid"), { timeout: 60_000 }),
    page.getByText("提交成功", { exact: false }).filter({ visible: true }).waitFor({ state: "visible", timeout: 60_000 }),
  ]).catch(async () => {
    const validation = await page.locator('[class*="error"],[role="alert"]').filter({ visible: true }).allInnerTexts();
    const message = validation.map((text) => text.replace(/\s+/g, " ").trim()).filter(Boolean).join("；");
    throw new Error(`TENCENT_HUOLONG_DRAMA_VIDEO_SUBMIT_FAILED${message ? `: ${message}` : ""}`);
  });
  const remainingSettleMs = postSubmitSettleMs - (Date.now() - finalSubmitClickedAt);
  if (remainingSettleMs > 0) {
    log(
      options,
      `[tencent-huolong-drama] 已检测到提交成功，继续保留任务标签页${Math.ceil(remainingSettleMs / 1_000)}秒`,
    );
    await page.waitForTimeout(remainingSettleMs);
  }
  log(options, "[tencent-huolong-drama] 全部视频已提交");
}
