import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import type { Locator, Page } from "playwright";
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
const otherPlatformPremiereDateFormat = "YYYY-MM-DD";
const expectedPremiereTimeInputFormats = [
  expectedPremiereTimeFormat,
  "YYYY-MM-DD HH:mm",
  "YYYY-MM-DDTHH:mm:ss",
  "YYYY-MM-DDTHH:mm",
];

function normalizeExpectedPremiereTimeText(value?: string) {
  if (!value?.trim()) {
    throw new Error("MEITUAN_EXPECTED_PREMIERE_TIME_REQUIRED");
  }

  const parsed = dayjs(value.trim(), expectedPremiereTimeInputFormats, true);
  if (!parsed.isValid()) {
    throw new Error(`MEITUAN_EXPECTED_PREMIERE_TIME_INVALID: ${value}`);
  }

  return parsed.format(expectedPremiereTimeFormat);
}

function normalizeOtherPlatformPremiereDateText(value?: string) {
  if (!value?.trim()) {
    throw new Error("MEITUAN_OTHER_PLATFORM_PREMIERE_DATE_REQUIRED");
  }

  const parsed = dayjs(value.trim(), otherPlatformPremiereDateFormat, true);
  if (!parsed.isValid()) {
    throw new Error(`MEITUAN_OTHER_PLATFORM_PREMIERE_DATE_INVALID: ${value}`);
  }

  return parsed.format(otherPlatformPremiereDateFormat);
}

async function closeVisibleDatePicker(page: Page) {
  const panel = page
    .locator(
      ".mtd-picker-panel:visible, " +
        ".mtd-date-picker-panel:visible, " +
        ".mtd-picker-popper:visible, " +
        ".mtd-date-picker-popper:visible, " +
        ".mtd-calendar:visible",
    )
    .last();

  if (!(await panel.isVisible({ timeout: 500 }).catch(() => false))) {
    return;
  }

  const confirmButton = panel.getByRole("button", { name: "确定", exact: true }).last();
  if (await confirmButton.isVisible({ timeout: 500 }).catch(() => false)) {
    await confirmButton.click({ timeout: 5_000 });
    await panel.waitFor({ state: "hidden", timeout: 3_000 }).catch(() => undefined);
  }
}

async function fillAndVerifyDateTextbox(options: {
  page: Page;
  textbox: Locator;
  value: string;
  fieldLabel: string;
}) {
  await scrollLocatorIntoView(options.page, options.textbox);
  await options.textbox.click({ timeout: 30_000 });
  await options.textbox.fill(options.value, { timeout: 30_000 });
  await options.textbox.press("Tab", { timeout: 30_000 });
  await options.page.waitForTimeout(300);

  const actualValue = (await options.textbox.inputValue()).trim();
  if (actualValue !== options.value) {
    throw new Error(
      `美团${options.fieldLabel}填写结果不一致：接口值=${options.value}，页面值=${actualValue || "(空)"}`,
    );
  }

  await closeVisibleDatePicker(options.page);
}

async function uploadCollectionCover(
  page: Page,
  taskConfig: MeituanCreationTaskConfig,
  options: MeituanCreationRuntimeOptions,
) {
  const coverPath =
    taskConfig.collectionCoverFile ??
    (taskConfig.collectionCoverUrl
      ? await downloadRemoteAsset(taskConfig.collectionCoverUrl, options, "remote-cover", "cover")
      : undefined);
  if (!coverPath) {
    throw new Error("MEITUAN_COLLECTION_COVER_REQUIRED");
  }
  const uploadArea = page.getByRole("button", { name: "上传封面" }).locator("..");
  const coverInput = uploadArea.locator('input[type="file"]');

  await scrollLocatorIntoView(page, uploadArea);
  await coverInput.setInputFiles(coverPath, { timeout: 30_000 });
}

async function uploadCopyrightProof(page: Page, proofPaths: string[]) {
  if (proofPaths.length === 0) {
    throw new Error("MEITUAN_COPYRIGHT_PROOF_REQUIRED");
  }
  const proofArea = await proofUploadContainer(page, "版权证明");

  await scrollLocatorIntoView(page, proofArea);
  for (const [index, proofPath] of proofPaths.entries()) {
    const proofInput = proofArea.locator(".label .mtd-upload-input").first();
    await proofInput.waitFor({ state: "attached", timeout: 30_000 });
    await proofInput.setInputFiles(proofPath, { timeout: 30_000 });
    await waitUploadCount(proofArea, index + 1, "版权证明");
  }
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
  const proofLabel =
    taskConfig.premiereStatus === "非美团首发"
      ? "其他平台首发证明材料"
      : "首发证明材料";
  const proofArea = await proofUploadContainer(page, proofLabel);
  const proofInput = proofArea.locator(".label .mtd-upload-input").first();

  await scrollLocatorIntoView(page, proofArea);
  await proofInput.waitFor({ state: "attached", timeout: 30_000 });
  await proofInput.setInputFiles(proofPath, { timeout: 30_000 });
  await waitUploadDone(page, proofLabel);
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
    await Promise.race([
      status.waitFor({ state: "visible", timeout }),
      waitForMtdMessageError(page, timeout),
    ]);
    return true;
  } catch {
    const message = await visibleMtdMessageError(page);
    if (message) {
      throw new Error(`MEITUAN_CREATE_COLLECTION_MESSAGE: ${message}`);
    }
    throw new Error(`上传未完成：${labelText}`);
  }
}

async function visibleMtdMessageError(page: Page) {
  const message = page
    .locator(".mtd-message.mtd-message-error .mtd-message-content:visible")
    .last();
  if (!(await message.count())) return undefined;
  return (await message.textContent())?.trim() || undefined;
}

async function waitForMtdMessageError(page: Page, timeout: number): Promise<never> {
  const message = page.locator(".mtd-message.mtd-message-error .mtd-message-content").last();
  await message.waitFor({ state: "visible", timeout });
  const text = (await message.textContent())?.trim() || "美团页面出现错误提示";
  throw new Error(`MEITUAN_CREATE_COLLECTION_MESSAGE: ${text}`);
}

async function waitUploadCount(
  container: ReturnType<Page["locator"]>,
  expectedCount: number,
  labelText: string,
  timeout = 30_000,
) {
  const deadline = Date.now() + timeout;
  const uploadedStatuses = container.locator("text=已上传");
  const failedStatuses = container.locator("text=上传失败");

  while (Date.now() < deadline) {
    const message = await visibleMtdMessageError(container.page());
    if (message) {
      throw new Error(`MEITUAN_CREATE_COLLECTION_MESSAGE: ${message}`);
    }
    if (await failedStatuses.count()) {
      throw new Error(`上传失败：${labelText}，第${expectedCount}个文件`);
    }
    const uploadedCount = await uploadedStatuses.count();
    if (uploadedCount >= expectedCount) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error(
    `上传未完成：${labelText}，期望${expectedCount}个，实际${await uploadedStatuses.count()}个`,
  );
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
  log(options, "[meituan-drama] selecting background");
  await selectSingleTag(
    page,
    "时代背景",
    "请选择时代背景，最多可以选择1个",
    taskConfig.backgroundText,
  );
  log(options, "[meituan-drama] selecting plot settings");
  await selectMultipleTags(
    page,
    "剧情设定",
    "请选择剧情设定，最多可以选择2个",
    taskConfig.plotSettingTexts,
  );
  log(options, "[meituan-drama] selecting story theme");
  await selectSingleTag(
    page,
    "故事主题",
    "请选择故事主题，最多可以选择1个",
    taskConfig.storyThemeText,
  );

  log(options, "[meituan-drama] filling total episodes");
  await fillTextbox(page, "总集数", "输入总集数", String(taskConfig.totalEpisodes));

  log(options, "[meituan-drama] selecting checkpoint episodes");
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
  log(options, "[meituan-drama] filling production company");
  await fillTextbox(page, "制作机构", "请填写制作机构", taskConfig.productionCompanyText);

  log(options, "[meituan-drama] selecting directors");
  await selectCustomMultiTags(page, "导演", "请填写导演姓名，支持多人", taskConfig.directorNames);

  log(options, "[meituan-drama] selecting producers");
  await selectCustomMultiTags(
    page,
    "制片人",
    "请填写制片人姓名，支持多人",
    taskConfig.producerNames,
  );

  log(options, "[meituan-drama] selecting screenwriters");
  await selectCustomMultiTags(
    page,
    "编剧",
    "请填写编剧姓名，支持多人",
    taskConfig.screenwriterNames,
  );

  log(options, "[meituan-drama] filling average episode duration");
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

  await closeVisibleDatePicker(page);
  await scrollLocatorIntoView(page, agreementTrigger);

  if (await checkbox.isChecked({ timeout: 1_000 }).catch(() => false)) {
    return;
  }

  if (await checkbox.count()) {
    await checkbox.evaluate((node) => {
      (node as HTMLInputElement).click();
    });
  } else {
    await agreementTrigger.evaluate((node) => {
      (node as HTMLElement).click();
    });
  }
  await page.waitForTimeout(100);

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
  log(options, "[meituan-drama] filling plot synopsis");
  const synopsisTextbox = page.getByRole("textbox", { name: "请填写剧情简介" });
  await scrollLocatorIntoView(page, synopsisTextbox);
  await synopsisTextbox.fill(taskConfig.plotSynopsisText, { timeout: 30_000 });

  log(options, "[meituan-drama] selecting premiere status");
  const premiereStatusTextbox = page.getByRole("textbox", {
    name: "请选择全网首发情况",
  });
  await scrollLocatorIntoView(page, premiereStatusTextbox);
  await premiereStatusTextbox.click();
  await page.getByText(taskConfig.premiereStatus, { exact: true }).click({ timeout: 30_000 });

  if (taskConfig.premiereStatus === "美团联合首发") {
    log(options, "[meituan-drama] filling expected premiere time");
    const expectedPremiereTimeText = normalizeExpectedPremiereTimeText(
      taskConfig.expectedPremiereTimeText,
    );
    log(options, `[meituan-drama] expected premiere time received: ${expectedPremiereTimeText}`);

    const expectedPremiereTimeTextbox = page.getByRole("textbox", {
      name: "请选择预计首发时间",
    });
    await fillAndVerifyDateTextbox({
      page,
      textbox: expectedPremiereTimeTextbox,
      value: expectedPremiereTimeText,
      fieldLabel: "预计首发时间",
    });
  } else if (taskConfig.premiereStatus === "非美团首发") {
    log(options, "[meituan-drama] filling other-platform premiere date");
    const otherPlatformPremiereDateText = normalizeOtherPlatformPremiereDateText(
      taskConfig.otherPlatformPremiereDateText,
    );
    log(
      options,
      `[meituan-drama] other-platform premiere date received: ${otherPlatformPremiereDateText}`,
    );
    const otherPlatformPremiereDateTextbox = page.getByRole("textbox", {
      name: "请选择其他平台首发时间",
    });
    await fillAndVerifyDateTextbox({
      page,
      textbox: otherPlatformPremiereDateTextbox,
      value: otherPlatformPremiereDateText,
      fieldLabel: "其他平台首发时间",
    });
  }

  log(options, "[meituan-drama] accepting copyright agreement");
  await clickCopyrightAgreement(page);

  log(options, "[meituan-drama] uploading premiere proof");
  await uploadPremiereProof(page, taskConfig, options);
}

async function fillCreateCollectionDrawerFields(
  page: Page,
  taskConfig: MeituanCreationTaskConfig,
  options: MeituanCreationRuntimeOptions,
  copyrightProofFiles: string[],
) {
  const collectionTypeTextbox = page.getByRole("textbox", { name: "选择合集类型" });
  const audienceTextbox = page.getByRole("textbox", { name: "请选择短漫剧受众" });
  const titleTextbox = page.getByRole("textbox", { name: "输入合集标题" });

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
  log(options, `[meituan-drama] uploading copyright proof: files=${copyrightProofFiles.length}`);
  await uploadCopyrightProof(page, copyrightProofFiles);
  await fillProductionInfo(page, taskConfig, options);
  await fillStoryAndRights(page, taskConfig, options);
  log(options, "[meituan-drama] confirming collection drawer");
  await confirmCreateCollectionDrawer(page);
}

export async function fillCreateCollectionDrawer(
  page: Page,
  taskConfig: MeituanCreationTaskConfig,
  options: MeituanCreationRuntimeOptions,
  copyrightProofFiles: string[],
) {
  const messageContent = page.locator(".mtd-message.mtd-message-error .mtd-message-content");
  const formItemErrors = page.locator(".mtd-form-item-error-tip:visible");
  await page.addLocatorHandler(
    messageContent,
    async (message) => {
      const text = (await message.last().textContent())?.trim() || "美团页面出现错误提示";
      throw new Error(`MEITUAN_CREATE_COLLECTION_MESSAGE: ${text}`);
    },
    { noWaitAfter: true },
  );

  try {
    await page.addLocatorHandler(
      formItemErrors,
      async (errors) => {
        const texts = [
          ...new Set((await errors.allInnerTexts()).map((text) => text.trim()).filter(Boolean)),
        ];
        throw new Error(
          `MEITUAN_CREATE_COLLECTION_FORM_INVALID: ${texts.join("；") || "表单数据校验失败"}`,
        );
      },
      { noWaitAfter: true },
    );
    try {
      await fillCreateCollectionDrawerFields(page, taskConfig, options, copyrightProofFiles);
    } finally {
      await page.removeLocatorHandler(formItemErrors);
    }
  } finally {
    await page.removeLocatorHandler(messageContent);
  }
}
