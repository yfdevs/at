import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  cleanupEpisodeUploadFiles,
  prepareEpisodeUploadFiles,
} from "@drama/drama-media-assets";
import type { Page } from "playwright";
import type { BaiduDramaRuntimeOptions, ClaimedBaiduDramaTask } from "../shared/types.js";
import { baiduDramaLocalRoot, baiduDramaResourceName } from "../shared/resources.js";
import { BAIDU_DRAMA_CREATE_URL } from "../shared/constants.js";
import { errorLog, log } from "../shared/logger.js";
import { waitForBaiduDramaCreatePageReady } from "./browser-session.js";
import {
  assertNoBaiduFormError,
  assertBaiduCoverUploadReceipt,
  clickBaiduNext,
  confirmBaiduDramaInformation,
  ensureCheckboxByExactText,
  fillByPlaceholder,
  fillTagValues,
  selectFormItem,
  selectDropdownOption,
  selectRadio,
  uploadCoverSlot,
  uploadFormFiles,
  type BaiduCoverUploadReceipt,
} from "./form-controls.js";

type BaiduAutomationAction = <T>(name: string, action: () => Promise<T>) => Promise<T>;

const episodeUploadPollIntervalMs = 5_000;
const postSubmitSettleMs = 10_000;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function logValue(value: unknown) {
  const text = Array.isArray(value)
    ? value
      .map((item) => typeof item === "string" ? item : JSON.stringify(item) ?? "")
      .join("、")
    : typeof value === "string"
      ? value
      : JSON.stringify(value) ?? "";
  const compact = text.replace(/\s+/g, " ").trim();
  return JSON.stringify(compact.length > 160 ? `${compact.slice(0, 157)}...` : compact);
}

function fileNames(files: string[]) {
  return files.length > 0 ? files.map((file) => path.basename(file)).join("、") : "无文件，跳过";
}

function requiredFirstFile(files: string[], source: string) {
  const file = files[0];
  if (!file) {
    throw new Error(`BAIDU_DRAMA_SHORT_CERTIFICATION_FILE_REQUIRED: ${source}`);
  }
  return file;
}

function createActionRunner(
  page: Page,
  options: BaiduDramaRuntimeOptions,
): BaiduAutomationAction {
  return async <T>(name: string, action: () => Promise<T>) => {
    log(options, `[baidu-drama] 脚本操作开始：${name}`, { action: name, url: page.url() }, "automation");
    try {
      const result = await action();
      log(options, `[baidu-drama] 脚本操作完成：${name}`, { action: name, url: page.url() }, "automation");
      return result;
    } catch (error) {
      errorLog(
        options,
        `[baidu-drama] 脚本操作失败：${name}；url=${page.url()}；错误=${errorMessage(error)}`,
        { action: name, url: page.url(), error },
        "automation",
      );
      throw error;
    }
  };
}

async function chooseDramaType(
  page: Page,
  task: ClaimedBaiduDramaTask,
  runAction: BaiduAutomationAction,
) {
  await runAction("选择短剧类型=非真人短剧", async () => {
    await page.getByText("非真人短剧", { exact: true }).filter({ visible: true }).first().click();
    const confirm = page.getByRole("button", { name: "确定", exact: true });
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
  });
  await runAction("短剧类型页点击下一步", () => clickBaiduNext(page));

  await runAction("选择经营模式=免费短剧", () =>
    page.getByText("免费短剧", { exact: true }).filter({ visible: true }).first().click());
  await runAction(`选择是否撮合剧=${task.playlet.isMatched ? "是" : "否"}`, () =>
    selectRadio(page, "是否撮合剧", task.playlet.isMatched ? "是" : "否"));
  if (task.playlet.isMatched && task.playlet.matchedIp) {
    await runAction(`选择关联版权IP=${logValue(task.playlet.matchedIp)}`, () =>
      selectFormItem(page, "关联版权IP", task.playlet.matchedIp!));
  }
  await runAction("经营模式页点击下一步", () => clickBaiduNext(page));
}

async function fillDramaInformation(
  page: Page,
  task: ClaimedBaiduDramaTask,
  runAction: BaiduAutomationAction,
  options: BaiduDramaRuntimeOptions,
) {
  const data = task.playlet;
  await runAction(`填写短剧名称=${logValue(data.title)}`, () =>
    fillByPlaceholder(page, "请勿使用删减版、短剧、合集等描述及特殊字符", data.title));
  const landscapeCoverFile = data.localLandscapeCoverFile ?? data.localCoverFile;
  const portraitCoverFile = data.localPortraitCoverFile ?? data.localCoverFile;
  if (!landscapeCoverFile || !portraitCoverFile) {
    throw new Error("BAIDU_DRAMA_COVER_FILE_REQUIRED");
  }
  const coverItem = (ratio: "16:9" | "3:4") => page
    .locator(".cheetah-space-item")
    .filter({ has: page.getByText(ratio, { exact: true }) })
    .first();
  const landscapeCoverSlot = coverItem("16:9").locator(".coverUploaderView").first();
  const portraitCoverSlot = coverItem("3:4").locator(".coverUploaderView").first();
  await runAction("检查16:9、3:4短剧封面上传位", async () => {
    await landscapeCoverSlot.waitFor({ state: "visible", timeout: 10_000 });
    await portraitCoverSlot.waitFor({ state: "visible", timeout: 10_000 });
  });
  const coverRetryLogger = (file: string) => (message: string) =>
    log(options, `[baidu-drama] ${message}`, { file }, "automation");
  let landscapeReceipt: BaiduCoverUploadReceipt | undefined;
  let portraitReceipt: BaiduCoverUploadReceipt | undefined;
  await runAction(`上传横屏封面[1/2]=${logValue(landscapeCoverFile)}`, async () => {
    landscapeReceipt = await uploadCoverSlot(page, landscapeCoverSlot, landscapeCoverFile, {
      label: "16:9",
      maxAttempts: 3,
      onRetry: coverRetryLogger(landscapeCoverFile),
    });
  });
  await runAction(`上传竖屏封面[2/2]=${logValue(portraitCoverFile)}`, async () => {
    portraitReceipt = await uploadCoverSlot(page, portraitCoverSlot, portraitCoverFile, {
      label: "3:4",
      maxAttempts: 3,
      onRetry: coverRetryLogger(portraitCoverFile),
    });
  });
  await runAction("检查横屏、3:4竖屏封面均已回填", async () => {
    if (!landscapeReceipt || !portraitReceipt) {
      throw new Error("BAIDU_DRAMA_BOTH_COVER_RECEIPTS_REQUIRED");
    }
    await assertBaiduCoverUploadReceipt(page, landscapeReceipt);
    await assertBaiduCoverUploadReceipt(page, portraitReceipt);
  });
  await runAction(`填写短剧简介=${logValue(data.summary)}`, () =>
    fillByPlaceholder(page, "请输入简介，优质简介有助于获得更多曝光", data.summary));
  await runAction(`选择剧情分类一级=${logValue(data.audienceType)}`, () =>
    selectFormItem(page, "剧情分类", data.audienceType));
  const categoryItems = page.locator(".cheetah-form-item").filter({
    has: page.getByText("剧情分类", { exact: true }),
  });
  await runAction(`选择剧情分类二级=${logValue(data.secondaryCategory)}`, async () => {
    const categoryComboboxes = categoryItems.locator('[role="combobox"]');
    const categorySelects = (await categoryComboboxes.count()) >= 2
      ? categoryComboboxes
      : categoryItems.locator(".cheetah-select");
    if ((await categorySelects.count()) > 1) {
      await selectDropdownOption(page, categorySelects.nth(1), data.secondaryCategory);
    } else {
      const visibleSelects = page.locator('[role="combobox"]:visible');
      await selectDropdownOption(page, visibleSelects.nth(1), data.secondaryCategory);
    }
  });
  await runAction(`填写全剧集数=${data.episodeCount}`, () =>
    fillByPlaceholder(page, "请输入全剧剧集数量(1-300)", String(data.episodeCount)));
  await runAction(`选择更新状态=${logValue(data.updateStatus)}`, () =>
    selectRadio(page, "更新状态", data.updateStatus));
  await runAction(`填写话题=${logValue(data.topic ?? "未提供")}`, () =>
    fillByPlaceholder(page, "请输入关键字获取相关话题", data.topic));

  const personnelName = data.productionOrganization;
  await runAction(`填写导演姓名=${logValue(personnelName)}`, () =>
    page.locator("#director_info_name").fill(personnelName));
  await runAction(`选择导演性别=${logValue(data.director.gender)}`, () =>
    selectRadio(page, "导演", data.director.gender));
  await runAction(`填写导演出生日期=${logValue(data.director.birthDate ?? "未提供")}`, () =>
    fillByPlaceholder(page, "请选择出生日期", data.director.birthDate));
  await runAction(`填写导演国籍=${logValue(data.director.nationality ?? "未提供")}`, () =>
    fillByPlaceholder(page, "请输入国籍", data.director.nationality));
  await runAction(`填写导演所属公司=${logValue(personnelName)}`, () =>
    fillByPlaceholder(page, "请输入所属公司", personnelName));
  await runAction(`填写制片人=${logValue(personnelName)}`, () =>
    fillTagValues(page, "制片人", [personnelName]));
  await runAction(`填写编剧=${logValue(personnelName)}`, () =>
    fillTagValues(page, "编剧", [personnelName]));

  await runAction(`准备演员输入框=${data.actors.length}个`, async () => {
    while ((await page.locator('[id^="actor_list_"][id$="_name"]').count()) < data.actors.length) {
      await page.getByRole("button", { name: "添加演员" }).click();
    }
  });
  for (const [index] of data.actors.entries()) {
    await runAction(
      `填写演员[${index + 1}/${data.actors.length}]=${logValue(personnelName)}，` +
        `角色=${logValue(personnelName)}`,
      async () => {
        await page.locator(`#actor_list_${index}_name`).fill(personnelName);
        await page.locator(`#actor_list_${index}_role_name`).fill(personnelName);
      },
    );
  }

  await runAction(`填写制作成本=${data.productionCost.amountWan}万元`, () =>
    fillByPlaceholder(page, "请输入制作成本（可输入小数点）", String(data.productionCost.amountWan)));
  await runAction(`上传成本配置=${fileNames(data.productionCost.proofFiles)}`, () =>
    uploadFormFiles(page, "成本配置", data.productionCost.proofFiles));
  await runAction(`填写制作机构=${logValue(data.productionOrganization)}`, () =>
    page.locator("#organization").fill(data.productionOrganization));
  const commitmentFile = data.commitmentFiles[0];
  const commitmentFiles = commitmentFile ? [commitmentFile] : [];
  await runAction(`上传承诺书=${fileNames(commitmentFiles)}`, () =>
    uploadFormFiles(page, "承诺书", commitmentFiles));
  const shortDramaCertificationFiles = [
    ...data.qualification.proofFiles,
    requiredFirstFile(data.productionCost.proofFiles, "成本配置"),
    requiredFirstFile(data.copyright.productionProofFiles, "制作证明"),
    requiredFirstFile(data.copyright.licenseProofFiles, "授权证明"),
  ];
  await runAction(`上传短剧认证=${fileNames(shortDramaCertificationFiles)}`, () =>
    uploadFormFiles(page, "短剧认证", shortDramaCertificationFiles));
  await runAction("勾选协议：我已阅读并同意以下内容", () =>
    ensureCheckboxByExactText(page, "我已阅读并同意以下内容"));
  await runAction("勾选协议：我已阅读并同意以下内容：", () =>
    ensureCheckboxByExactText(page, "我已阅读并同意以下内容："));
  await runAction("允许用户下载短剧内容", () =>
    ensureCheckboxByExactText(page, "同意用户在百度、百家号及其平台内下载短剧内容"));
  await runAction("勾选AI创作声明", () =>
    ensureCheckboxByExactText(
      page,
      "如果当前内容中有使用AI生成的图片等资源，您可以勾选AI创作声明",
    ));
}

async function uploadEpisodes(
  page: Page,
  task: ClaimedBaiduDramaTask,
  options: BaiduDramaRuntimeOptions,
  runAction: BaiduAutomationAction,
) {
  const uploadRootDir = options.assetDownloadDir ?? path.resolve(process.cwd(), ".drama-runs/baidu-drama/assets");
  await mkdir(uploadRootDir, { recursive: true });
  const prepared = await runAction(`准备剧集视频=${task.playlet.episodeCount}集`, () =>
    prepareEpisodeUploadFiles({
      localEpisodeVideoRoot: baiduDramaLocalRoot(options),
      resourceName: baiduDramaResourceName(task),
      uploadRootDir,
      uploadBaseName: task.playlet.title,
    }));
  try {
    const uploadPanel = await runAction("点击上传短剧并等待本地上传面板", async () => {
      const uploadButton = page
        .getByRole("button", { name: "上传短剧", exact: true })
        .filter({ visible: true })
        .first();
      await uploadButton.waitFor({ state: "visible", timeout: 15_000 });
      await uploadButton.click();

      const panel = page
        .locator('[role="tabpanel"][aria-hidden="false"]')
        .filter({ has: page.getByText("本地上传", { exact: true }) })
        .first();
      await panel.waitFor({ state: "visible", timeout: 15_000 });
      await panel
        .locator('input[type="file"][multiple][accept*=".mp4"]')
        .first()
        .waitFor({ state: "attached", timeout: 15_000 });
      return panel;
    });
    await runAction(`选择并上传剧集视频=${prepared.files.length}个文件`, async () => {
      const videoInput = uploadPanel
        .locator('input[type="file"][multiple][accept*=".mp4"]')
        .first();
      await videoInput.setInputFiles(prepared.files, { timeout: 120_000 });
      await page.waitForTimeout(500);
      await assertNoBaiduFormError(page, "上传剧集视频");
    });
    const timeout = Math.max(1, options.episodeUploadWaitTimeoutMinutes ?? 120) * 60_000;
    await runAction(`等待${prepared.files.length}集上传完成，超时=${timeout / 60_000}分钟`, async () => {
      const expectedCount = prepared.files.length;
      const deadline = Date.now() + timeout;
      let lastStatus = "";

      while (Date.now() < deadline) {
        await assertNoBaiduFormError(page, "等待剧集上传完成");

        const episodeCards = page
          .locator('div[class*="-selfVideo"]')
          .filter({ has: page.locator('div[class*="-num"]') });
        const totalCount = await episodeCards.count();
        const completedCount = await episodeCards
          .filter({ has: page.getByText("改剧集", { exact: true }) })
          .count();
        const uploadingCount = await episodeCards
          .filter({ has: page.locator('[role="progressbar"]') })
          .count();
        const waitingCount = Math.max(0, totalCount - completedCount - uploadingCount);
        const failedCards = await episodeCards
          .filter({ hasText: /上传失败|处理失败|转码失败|上传异常/ })
          .allInnerTexts();
        if (failedCards.length > 0) {
          throw new Error(
            `BAIDU_DRAMA_EPISODE_UPLOAD_FAILED: ${failedCards
              .map((text) => text.replace(/\s+/g, " ").trim())
              .join("；")}`,
          );
        }

        const status =
          `已出现=${totalCount}/${expectedCount}，已完成=${completedCount}/${expectedCount}，` +
          `上传中=${uploadingCount}，等待中=${waitingCount}`;
        if (status !== lastStatus) {
          lastStatus = status;
          log(options, `[baidu-drama] 剧集上传进度：${status}`, undefined, "automation");
        }
        if (
          totalCount === expectedCount &&
          completedCount === expectedCount &&
          uploadingCount === 0
        ) {
          await assertNoBaiduFormError(page, "剧集全部上传完成");
          return;
        }

        await page.waitForTimeout(episodeUploadPollIntervalMs);
      }

      throw new Error(
        `BAIDU_DRAMA_EPISODE_UPLOAD_TIMEOUT: timeoutMinutes=${timeout / 60_000}；` +
          (lastStatus || `未检测到剧集卡片，期望=${prepared.files.length}`),
      );
    });
  } finally {
    await runAction("清理剧集上传临时文件", () => cleanupEpisodeUploadFiles(prepared));
  }
}

export async function runBaiduDramaPublishTask(
  page: Page,
  task: ClaimedBaiduDramaTask,
  options: BaiduDramaRuntimeOptions,
) {
  const runAction = createActionRunner(page, options);
  log(
    options,
    `[baidu-drama] 发布脚本开始：taskId=${task.accountTaskId}，剧名=${logValue(task.playlet.title)}`,
    { accountTaskId: task.accountTaskId, title: task.playlet.title },
    "publish",
  );
  try {
    await runAction(`打开百度短剧创建页=${BAIDU_DRAMA_CREATE_URL}`, async () => {
      await page.goto(BAIDU_DRAMA_CREATE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await waitForBaiduDramaCreatePageReady(page);
    });
    await chooseDramaType(page, task, runAction);
    await fillDramaInformation(page, task, runAction, options);
    await runAction("短剧信息页点击下一步", () => clickBaiduNext(page));
    await runAction("短剧信息确认弹窗点击确定", () => confirmBaiduDramaInformation(page));
    await runAction("等待上传视频内容页面就绪", () =>
      page.getByText("上传视频内容", { exact: true }).first().waitFor({ state: "visible", timeout: 15_000 }));
    await uploadEpisodes(page, task, options, runAction);

    if (!task.playlet.submit) {
      log(
        options,
        "[baidu-drama] 发布脚本完成：submit=false，已填写并上传，未提交审核。",
        { accountTaskId: task.accountTaskId, submitted: false },
        "publish",
      );
      return;
    }
    await runAction("提交短剧审核", async () => {
      const submitButton = page
        .locator(
          'button.cheetah-btn-circle.cheetah-btn-primary.cheetah-btn-icon-only[class*="-alwaysBlue"]',
        )
        .filter({ visible: true })
        .last();
      await submitButton.waitFor({ state: "visible", timeout: 15_000 });
      await submitButton.scrollIntoViewIfNeeded();
      await submitButton.click({ timeout: 15_000 });

      const confirm = page
        .getByRole("button", { name: /确定|确认提交/ })
        .filter({ visible: true })
        .last();
      const confirmationVisible = await confirm
        .waitFor({ state: "visible", timeout: 3_000 })
        .then(() => true)
        .catch(() => false);
      if (confirmationVisible) await confirm.click();
      log(
        options,
        `[baidu-drama] 已点击提交审核，等待${postSubmitSettleMs / 1_000}秒后关闭任务标签页。`,
        undefined,
        "automation",
      );
      await page.waitForTimeout(postSubmitSettleMs);
      await assertNoBaiduFormError(page, "提交短剧审核");
    });
    log(
      options,
      "[baidu-drama] 发布脚本完成：已提交审核。",
      { accountTaskId: task.accountTaskId, submitted: true },
      "publish",
    );
    await page.close();
  } catch (error) {
    errorLog(
      options,
      `[baidu-drama] 发布脚本失败：taskId=${task.accountTaskId}；url=${page.url()}；错误=${errorMessage(error)}`,
      { accountTaskId: task.accountTaskId, url: page.url(), error },
      "publish",
    );
    throw error;
  }
}
