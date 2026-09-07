import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { tencentHuolongThemeOptionId } from "../shared/constants.js";
import { log } from "../shared/logger.js";
import type {
  ClaimedTencentHuolongDramaTask,
  TencentHuolongRuntimeOptions,
  TencentHuolongTheme,
} from "../shared/types.js";
import type { TencentHuolongCoverFiles } from "../shared/covers.js";

function visibleText(page: Page, text: string) {
  return page.getByText(text, { exact: true }).filter({ visible: true });
}

async function clickText(page: Page, text: string, occurrence = 0) {
  const locator = visibleText(page, text);
  const count = await locator.count();
  if (count <= occurrence) throw new Error(`TENCENT_HUOLONG_DRAMA_OPTION_NOT_FOUND: ${text}`);
  await locator.nth(occurrence).click({ timeout: 15_000 });
}

async function clickFieldOption(page: Page, fieldName: string, text: string) {
  const option = page.locator(`[data-field-name="${fieldName}"]`).getByText(text, { exact: true }).filter({ visible: true });
  await option.first().click({ timeout: 15_000 });
}

async function checkNamedRadio(page: Page, name: string, index: number) {
  const radio = page.locator(`input[type="radio"][name="${name}"]`).nth(index);
  await radio.waitFor({ state: "attached", timeout: 15_000 });
  if (!await radio.isChecked()) await radio.check({ force: true });
}

async function checkRadioByFieldName(page: Page, fieldName: string, index: number) {
  const radio = page.locator(`[data-field-name="${fieldName}"] input[type="radio"]`).nth(index);
  await radio.waitFor({ state: "attached", timeout: 15_000 });
  if (!await radio.isChecked()) await radio.check({ force: true });
}

async function fillField(page: Page, fieldName: string, value: string) {
  const input = page.locator(`[data-field-name="${fieldName}"] input, [data-field-name="${fieldName}"] textarea`).first();
  await input.waitFor({ state: "visible", timeout: 20_000 });
  await input.fill(value);
}

async function chooseTheme(page: Page, theme: TencentHuolongTheme) {
  const root = page.locator('[data-field-name="micro_comic_theme"]');
  await root.locator('div[class*="_input_"]').first().click();
  const optionId = tencentHuolongThemeOptionId[theme];
  const option = root.locator(`[data-value="${optionId}"]`);
  if (await option.count() === 0) {
    const index = Object.keys(tencentHuolongThemeOptionId).indexOf(theme);
    await root.locator('div[class*="_optionList_"]').evaluate((element, scrollTop) => {
      element.scrollTop = scrollTop;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    }, Math.max(0, index - 2) * 40);
  }
  await root.locator(`[data-value="${optionId}"]`).waitFor({ state: "attached", timeout: 10_000 });
  await root.locator(`[data-value="${optionId}"]`).click();
}

async function confirmCropIfPresent(page: Page) {
  await page.waitForTimeout(300);
  const dialog = page.locator('[role="dialog"],div[class*="modal"],div[class*="dialog"]').filter({ visible: true }).last();
  if (await dialog.count() === 0) return;
  for (const label of ["确定", "完成", "保存"]) {
    const button = dialog.getByRole("button", { name: label, exact: true }).filter({ visible: true });
    if (await button.count() > 0) {
      await button.last().click();
      await dialog.waitFor({ state: "hidden", timeout: 30_000 }).catch(() => undefined);
      return;
    }
  }
}

async function uploadCover(page: Page, options: { inputSelector?: string; label: string; file: string }) {
  const input = options.inputSelector ? page.locator(options.inputSelector) : null;
  if (input && await input.count() > 0) {
    await input.setInputFiles(options.file);
  } else {
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 15_000 });
    await clickText(page, options.label);
    const chooser = await chooserPromise;
    await chooser.setFiles(options.file);
  }
  await confirmCropIfPresent(page);
}

async function resolveFile(reference: string, options: TencentHuolongRuntimeOptions) {
  if (!/^https?:\/\//i.test(reference)) return reference;
  if (!options.assetDownloadDir) throw new Error("TENCENT_HUOLONG_DRAMA_ASSET_DIR_REQUIRED");
  const response = await fetch(reference, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
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
  references: string[],
  options: TencentHuolongRuntimeOptions,
) {
  const localFiles = await Promise.all(references.map((reference) => resolveFile(reference, options)));
  const input = page.locator(`[data-field-name="${fieldName}"] input[type="file"]`).first();
  await input.waitFor({ state: "attached", timeout: 15_000 });
  await input.setInputFiles(await input.getAttribute("multiple") === null ? localFiles.slice(0, 1) : localFiles);
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

  await uploadCover(page, { inputSelector: "#uploadHorCoverButton", label: "上传横版图片", file: covers.landscape });
  await uploadCover(page, { inputSelector: "#uploadVerCoverButton", label: "上传竖版图片", file: covers.portrait });
  await uploadCover(page, { label: "上传榜单封面图", file: covers.ranking });
  await uploadCover(page, { label: "上传横版卡片图", file: covers.card });

  await checkNamedRadio(page, "is_ai_real_person_short_drama", task.playlet.isAiRealPersonShortDrama === "是" ? 0 : 1);
  await clickFieldOption(page, "micro_series_mode", "非独家首播");
  await clickFieldOption(page, "distribution_platform", "火龙漫剧+腾讯视频");
  await clickFieldOption(page, "kairos_pay_mode", "免费");
  await clickFieldOption(page, "pay_model", "免费");
  await chooseTheme(page, task.playlet.themeType);

  await checkNamedRadio(page, "is_end_update", 0);
  await page.locator('[data-field-name="total_episode"] input[type="number"]').fill(String(task.playlet.episodeCount));
  await page.locator('[data-field-name="micro_series_duration"] input[type="number"]').fill("1");
  await checkNamedRadio(page, "is_adapted_from_ip", 1);
  await page.locator('[data-field-name="budget_str"] input[type="number"]').fill("1");
  await checkNamedRadio(page, "is_cp_key_record", 1);
  await checkRadioByFieldName(page, "has_own_copyright", 1);

  await uploadFilesByFieldName(page, "ohter_micro_cover_costing", task.playlet.costAnalysisFiles, options);
  await uploadFilesByFieldName(page, "rights_supplementary_files", task.playlet.copyrightProofFiles, options);
  await uploadFilesByFieldName(page, "personal_commitment_letter_file", task.playlet.nonInfringementCommitmentFiles, options);
  await uploadFilesByFieldName(page, "source_file_screenshot_files", task.playlet.productionProcessFiles, options);

  await checkRadioByFieldName(page, "auth_duration", 0);
  await checkRadioByFieldName(page, "aboard_area_limit", 2);
  const broadcastRight = page.locator('[data-field-name="granted_rights"] input[type="checkbox"][name="广播权"]');
  if (!await broadcastRight.isChecked()) await broadcastRight.check({ force: true });
  log(options, "[tencent-huolong-drama] 首屏全部必填项已填写");
}

export async function submitAndOpenVideoStep(page: Page, options: TencentHuolongRuntimeOptions) {
  const button = page.getByRole("button", { name: "提交并添加视频", exact: true }).filter({ visible: true });
  await button.click({ timeout: 20_000 });
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
  const submit = page.getByRole("button", { name: "提交", exact: true }).filter({ visible: true });
  await submit.last().click({ timeout: 30_000 });

  const continueSubmit = page.getByRole("button", { name: "继续提交", exact: true }).filter({ visible: true });
  await continueSubmit.last().waitFor({ state: "visible", timeout: 3_000 })
    .then(() => continueSubmit.last().click())
    .catch(() => undefined);

  await Promise.race([
    page.waitForURL((url) => !url.pathname.startsWith("/kairos/publish/cid/vid"), { timeout: 60_000 }),
    page.getByText("提交成功", { exact: false }).filter({ visible: true }).waitFor({ state: "visible", timeout: 60_000 }),
  ]).catch(async () => {
    const validation = await page.locator('[class*="error"],[role="alert"]').filter({ visible: true }).allInnerTexts();
    const message = validation.map((text) => text.replace(/\s+/g, " ").trim()).filter(Boolean).join("；");
    throw new Error(`TENCENT_HUOLONG_DRAMA_VIDEO_SUBMIT_FAILED${message ? `: ${message}` : ""}`);
  });
  log(options, "[tencent-huolong-drama] 全部视频已提交");
}
