import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import type { Page } from "playwright";
import type {
  MeituanCreationRuntimeOptions,
  MeituanCreationTaskConfig,
} from "../../shared/types.js";
import { log } from "../browser-session.js";
import {
  clickWhenReady,
  exactTextPattern,
  fillTextbox,
  scrollLocatorIntoView,
  selectCustomMultiTags,
  selectMultipleTags,
  selectSingleTag,
} from "../form-controls.js";
import { downloadRemoteAsset } from "../upload/remote-assets.js";

dayjs.extend(customParseFormat);

const expectedPremiereTimeFormat = "YYYY-MM-DD HH:mm:ss";
const expectedPremiereTimeInputFormats = [
  expectedPremiereTimeFormat,
  "YYYY-MM-DD HH:mm",
  "YYYY-MM-DDTHH:mm:ss",
  "YYYY-MM-DDTHH:mm",
];

function normalizeExpectedPremiereTimeText(value: string) {
  const parsed = dayjs(value.trim(), expectedPremiereTimeInputFormats, true);
  if (!parsed.isValid()) {
    throw new Error(`MEITUAN_EXPECTED_PREMIERE_TIME_INVALID: ${value}`);
  }

  const minimum = dayjs().add(1, "minute");
  if (parsed.isBefore(minimum)) {
    return minimum.format(expectedPremiereTimeFormat);
  }

  return parsed.format(expectedPremiereTimeFormat);
}

async function uploadCollectionCover(
  page: Page,
  taskConfig: MeituanCreationTaskConfig,
  options: MeituanCreationRuntimeOptions,
) {
  const coverPath = await downloadRemoteAsset(
    taskConfig.collectionCoverUrl,
    options,
    "remote-cover",
    "cover",
  );
  const uploadArea = page.getByRole("button", { name: "上传封面" }).locator("..");
  const coverInput = uploadArea.locator('input[type="file"]');

  await scrollLocatorIntoView(page, uploadArea);
  await coverInput.setInputFiles(coverPath, { timeout: 30_000 });
  await page.waitForTimeout(500);
}

async function uploadCopyrightProof(
  page: Page,
  taskConfig: MeituanCreationTaskConfig,
  options: MeituanCreationRuntimeOptions,
) {
  const proofPath = await downloadRemoteAsset(
    taskConfig.copyrightProofUrl,
    options,
    "remote-copyright-proof",
    "copyright proof",
  );
  const proofArea = await proofUploadContainer(page, "版权证明");
  const proofInput = proofArea.locator(".label .mtd-upload-input").first();

  await scrollLocatorIntoView(page, proofArea);
  await proofInput.waitFor({ state: "attached", timeout: 30_000 });
  await proofInput.setInputFiles(proofPath, { timeout: 30_000 });
  await waitUploadDone(page, "版权证明");
  await page.waitForTimeout(1_000);
}

async function uploadPremiereProof(
  page: Page,
  taskConfig: MeituanCreationTaskConfig,
  options: MeituanCreationRuntimeOptions,
) {
  const proofPath = await downloadRemoteAsset(
    taskConfig.premiereProofUrl,
    options,
    "remote-premiere-proof",
    "premiere proof",
  );
  const proofArea = await proofUploadContainer(page, "首发证明材料");
  const proofInput = proofArea.locator(".label .mtd-upload-input").first();

  await scrollLocatorIntoView(page, proofArea);
  await proofInput.waitFor({ state: "attached", timeout: 30_000 });
  await proofInput.setInputFiles(proofPath, { timeout: 30_000 });
  await waitUploadDone(page, "首发证明材料");
  await page.waitForTimeout(1_000);
}

async function proofUploadContainer(page: Page, labelText: string) {
  const container = page
    .locator(".upload-file-container:visible")
    .filter({
      has: page.locator(".label-title").filter({ hasText: exactTextPattern(labelText) }),
    })
    .last();

  await container.waitFor({ state: "visible", timeout: 30_000 });
  return container;
}

async function waitUploadDone(page: Page, labelText: string, timeout = 30_000) {
  const container = page.locator(".upload-file-container", {
    has: page.locator(".label-title", { hasText: labelText }),
  });
  const status = container.locator("text=已上传").first();
  try {
    await status.waitFor({ state: "visible", timeout });
    return true;
  } catch {
    throw new Error(`上传未完成：${labelText}`);
  }
}

async function confirmCreateCollectionDrawer(page: Page) {
  await page.getByRole("button", { name: "确定" }).click({ timeout: 30_000 });
  await page.waitForTimeout(300);

  const errorTips = page.locator(".mtd-form-item-error-tip:visible");
  const errorTexts = (await errorTips.allInnerTexts().catch(() => []))
    .map((text) => text.trim())
    .filter(Boolean);
  if (errorTexts.length > 0 || (await errorTips.count().catch(() => 0)) > 0) {
    throw new Error(
      `MEITUAN_CREATE_COLLECTION_FORM_INVALID: ${errorTexts.join("; ") || "visible form error"}`,
    );
  }

  await page
    .locator(".mtd-drawer:visible, .mtd-drawer-wrapper:visible, .mtd-drawer-container:visible")
    .last()
    .waitFor({ state: "hidden", timeout: 60_000 })
    .catch(() => undefined);
}

async function confirmCoverUploadDialog(page: Page) {
  const confirmButton = page
    .locator("button")
    .filter({ hasText: /^确定$/ })
    .last();

  await confirmButton.waitFor({ state: "visible", timeout: 60_000 });
  await confirmButton.click({ timeout: 30_000 });
  await confirmButton.waitFor({ state: "hidden", timeout: 30_000 }).catch(() => undefined);
}

async function fillCollectionMetadata(
  page: Page,
  taskConfig: MeituanCreationTaskConfig,
  options: MeituanCreationRuntimeOptions,
) {
  log(options, "[meituan-creation] selecting background");
  await selectSingleTag(
    page,
    "时代背景",
    "请选择时代背景，最多可以选择1个",
    taskConfig.backgroundText,
  );
  log(options, "[meituan-creation] selecting plot settings");
  await selectMultipleTags(
    page,
    "剧情设定",
    "请选择剧情设定，最多可以选择2个",
    taskConfig.plotSettingTexts,
  );
  log(options, "[meituan-creation] selecting story theme");
  await selectSingleTag(
    page,
    "故事主题",
    "请选择故事主题，最多可以选择1个",
    taskConfig.storyThemeText,
  );

  log(options, "[meituan-creation] filling total episodes");
  await fillTextbox(page, "总集数", "输入总集数", String(taskConfig.totalEpisodes));

  log(options, "[meituan-creation] selecting checkpoint episodes");
  await selectMultipleTags(
    page,
    "卡点集",
    "请选择卡点集",
    taskConfig.checkpointEpisodes.map((episode) => `第${episode}集`),
  );
}

async function fillProductionInfo(
  page: Page,
  taskConfig: MeituanCreationTaskConfig,
  options: MeituanCreationRuntimeOptions,
) {
  log(options, "[meituan-creation] filling production company");
  await fillTextbox(page, "制作机构", "请填写制作机构", taskConfig.productionCompanyText);

  log(options, "[meituan-creation] selecting directors");
  await selectCustomMultiTags(page, "导演", "请填写导演姓名，支持多人", taskConfig.directorNames);

  log(options, "[meituan-creation] selecting producers");
  await selectCustomMultiTags(
    page,
    "制片人",
    "请填写制片人姓名，支持多人",
    taskConfig.producerNames,
  );

  log(options, "[meituan-creation] selecting screenwriters");
  await selectCustomMultiTags(
    page,
    "编剧",
    "请填写编剧姓名，支持多人",
    taskConfig.screenwriterNames,
  );

  log(options, "[meituan-creation] selecting actors");
  await selectCustomMultiTags(page, "演员", "请填写演员姓名，支持多人", taskConfig.actorNames);

  log(options, "[meituan-creation] filling average episode duration");
  await fillTextbox(
    page,
    "单集平均时长",
    "请填写单集平均时长(分钟)",
    String(taskConfig.averageEpisodeDurationMinutes),
  );
}

async function clickCopyrightAgreement(page: Page) {
  const agreementText = "我已阅读并同意以下内容";
  const agreementLabel = page.locator("label").filter({ hasText: agreementText }).last();
  const agreementTrigger = (await agreementLabel.count())
    ? agreementLabel
    : page.getByText(agreementText).last();
  const checkbox = agreementTrigger
    .locator("xpath=ancestor::*[.//input[@type='checkbox']][1]")
    .locator("input[type='checkbox']")
    .first();

  await scrollLocatorIntoView(page, agreementTrigger);

  if (await checkbox.isChecked({ timeout: 1_000 }).catch(() => false)) {
    return;
  }

  await agreementTrigger.click({ timeout: 30_000 });
  await page.waitForTimeout(200);

  if (
    (await checkbox.count()) &&
    !(await checkbox.isChecked({ timeout: 1_000 }).catch(() => false))
  ) {
    throw new Error("MEITUAN_COPYRIGHT_AGREEMENT_CHECK_FAILED");
  }
}

async function fillStoryAndRights(
  page: Page,
  taskConfig: MeituanCreationTaskConfig,
  options: MeituanCreationRuntimeOptions,
) {
  log(options, "[meituan-creation] filling plot synopsis");
  const synopsisTextbox = page.getByRole("textbox", { name: "请填写剧情简介" });
  await synopsisTextbox.fill(taskConfig.plotSynopsisText, { timeout: 30_000 });

  log(options, "[meituan-creation] selecting premiere status");
  await page.getByRole("textbox", { name: "请选择全网首发情况" }).click();
  await page.getByText(taskConfig.premiereStatus, { exact: true }).click({ timeout: 30_000 });
  await page.waitForTimeout(1_000);

  log(options, "[meituan-creation] filling expected premiere time");
  const expectedPremiereTimeText = normalizeExpectedPremiereTimeText(
    taskConfig.expectedPremiereTimeText,
  );
  if (expectedPremiereTimeText !== taskConfig.expectedPremiereTimeText) {
    log(options, `[meituan-creation] expected premiere time adjusted: ${expectedPremiereTimeText}`);
  }

  const expectedPremiereTimeTextbox = page.getByRole("textbox", {
    name: "请选择预计首发时间",
  });
  await expectedPremiereTimeTextbox.evaluate((node, value) => {
    const input = node as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, expectedPremiereTimeText);
  await page.waitForTimeout(200);
  await expectedPremiereTimeTextbox.click({ timeout: 30_000 });
  await page
    .getByText(
      "预计首发时间（需满足全网同步上线（含付费及免费内容），若其他平台已先行发布付费版本，则不符合美团首发资质）",
      { exact: true },
    )
    .click({ timeout: 30_000 })
    .catch(async () => {
      await page.getByText("版权声明").click({ timeout: 30_000 });
    });
  await page.waitForTimeout(300);

  log(options, "[meituan-creation] accepting copyright agreement");
  await clickCopyrightAgreement(page);

  log(options, "[meituan-creation] uploading premiere proof");
  await uploadPremiereProof(page, taskConfig, options);
}

export async function fillCreateCollectionDrawer(
  page: Page,
  taskConfig: MeituanCreationTaskConfig,
  options: MeituanCreationRuntimeOptions,
) {
  const collectionTypeTextbox = page.getByRole("textbox", { name: "选择合集类型" });
  const audienceTextbox = page.getByRole("textbox", { name: "请选择短漫剧受众" });
  const titleTextbox = page.getByRole("textbox", { name: "输入合集标题" });

  await page.waitForTimeout(500);
  await scrollLocatorIntoView(page, collectionTypeTextbox);
  await collectionTypeTextbox.click({ timeout: 30_000 });
  await clickWhenReady(page, page.getByText(taskConfig.collectionType));
  await clickWhenReady(page, page.getByText(taskConfig.collectionSubType, { exact: true }));

  await scrollLocatorIntoView(page, audienceTextbox);
  await audienceTextbox.click({ timeout: 30_000 });
  await clickWhenReady(page, page.getByText(taskConfig.audience));

  await scrollLocatorIntoView(page, titleTextbox);
  await titleTextbox.fill(taskConfig.collectionTitle, { timeout: 30_000 });

  await uploadCollectionCover(page, taskConfig, options);
  await confirmCoverUploadDialog(page);
  await fillCollectionMetadata(page, taskConfig, options);
  log(options, "[meituan-creation] uploading copyright proof");
  await uploadCopyrightProof(page, taskConfig, options);
  await fillProductionInfo(page, taskConfig, options);
  await fillStoryAndRights(page, taskConfig, options);
  log(options, "[meituan-creation] confirming collection drawer");
  await page.waitForTimeout(2000);
  await confirmCreateCollectionDrawer(page);
}
