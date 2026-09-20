import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  cleanupEpisodeUploadFiles,
  prepareEpisodeUploadFiles,
} from "@drama/drama-media-assets";
import type { Page } from "playwright";
import {
  DOUYIN_DRAMA_CREATE_URL,
  DOUYIN_DRAMA_PRODUCTION_COST_RANGE,
  DOUYIN_DRAMA_UPDATE_STATUS,
} from "../shared/constants.js";
import {
  createDouyinDramaDropdownRecorder,
  type DouyinDramaDropdownRecorder,
} from "../shared/dropdown-options.js";
import { errorLog, log } from "../shared/logger.js";
import { douyinDramaLocalRoot, douyinDramaResourceName } from "../shared/resources.js";
import type { ClaimedDouyinDramaTask, DouyinDramaRuntimeOptions } from "../shared/types.js";
import { waitForDouyinDramaCreatePageReady } from "./browser-session.js";
import {
  addDouyinRole,
  assertNoDouyinFormError,
  clickDouyinNext,
  douyinFormItem,
  fillDouyinSeriesDialog,
  fillDouyinEpisodeBatchEdit,
  fillNearestDouyinCompletionPromiseDateTime,
  fillDouyinPublishDateTime,
  fillInputById,
  fillStableInputById,
  installDouyinPageMessageCapture,
  resetRestoredDouyinFormIfPresent,
  selectDropdownByPlaceholder,
  selectDropdownValues,
  selectDouyinChargeEpisodes,
  selectFirstDropdownByPlaceholder,
  selectRadio,
  selectSearchableDropdownByPlaceholder,
  selectVisibleRadio,
  uploadFormFiles,
} from "./form-controls.js";

type DouyinAutomationAction = <T>(name: string, action: () => Promise<T>) => Promise<T>;

const episodeUploadPollIntervalMs = 5_000;
const postSubmitSettleMs = 10_000;
const salesConfigurationSelector = [
  "#complete_promise_time input",
  'input[placeholder="请选择更新完成时间"]',
  "#complete_promise_time_input",
  "#unit_price_input",
  "#charge_episode",
].join(", ");

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function logValue(value: unknown) {
  const text = Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join("、")
    : typeof value === "string"
      ? value
      : value === undefined || value === null
        ? ""
        : JSON.stringify(value);
  const compact = text.replace(/\s+/g, " ").trim();
  return JSON.stringify(compact.length > 160 ? `${compact.slice(0, 157)}...` : compact);
}

function fileNames(files: string[]) {
  return files.length > 0 ? files.map((file) => path.basename(file)).join("、") : "无文件，跳过";
}

function createActionRunner(page: Page, options: DouyinDramaRuntimeOptions): DouyinAutomationAction {
  return async <T>(name: string, action: () => Promise<T>) => {
    log(options, `[douyin-drama] 脚本操作开始：${name}`, { action: name, url: page.url() }, "automation");
    try {
      await installDouyinPageMessageCapture(page);
      const result = await action();
      await installDouyinPageMessageCapture(page);
      await assertNoDouyinFormError(page, name);
      log(options, `[douyin-drama] 脚本操作完成：${name}`, { action: name, url: page.url() }, "automation");
      return result;
    } catch (error) {
      let failure = error;
      try {
        await installDouyinPageMessageCapture(page);
        await assertNoDouyinFormError(page, name);
      } catch (pageError) {
        failure = pageError;
      }
      errorLog(
        options,
        `[douyin-drama] 脚本操作失败：${name}；url=${page.url()}；错误=${errorMessage(failure)}`,
        { action: name, url: page.url(), error: failure },
        "automation",
      );
      throw failure;
    }
  };
}

async function fillBasicInformation(
  page: Page,
  task: ClaimedDouyinDramaTask,
  options: DouyinDramaRuntimeOptions,
  runAction: DouyinAutomationAction,
  recorder: DouyinDramaDropdownRecorder,
) {
  const data = task.playlet;
  await runAction(`填写作品名称=${logValue(data.title)}`, () =>
    fillInputById(page, "book_name_input", data.title));
  await runAction(`填写作品简介=${logValue(data.summary)}`, () =>
    fillInputById(page, "abstract_input", data.summary));
  if (!data.localHongguoCoverFile || !data.localDouyinCoverFile) {
    throw new Error("DOUYIN_DRAMA_COVER_FILE_REQUIRED");
  }
  await runAction(`上传红果封面图=${logValue(data.localHongguoCoverFile)}`, () =>
    uploadFormFiles(page, "红果封面图", [data.localHongguoCoverFile!]));
  await runAction(`上传抖音封面图=${logValue(data.localDouyinCoverFile)}`, () =>
    uploadFormFiles(page, "抖音封面图", [data.localDouyinCoverFile!]));
  await runAction(`填写承诺总集数=${data.episodeCount}`, () =>
    fillInputById(page, "final_chapter_number_input", data.episodeCount));
  await runAction(`选择更新状态=${DOUYIN_DRAMA_UPDATE_STATUS}`, () =>
    selectRadio(page, "更新状态", DOUYIN_DRAMA_UPDATE_STATUS));
  await runAction(`选择是否AI作品=${data.isAi ? "是" : "否"}`, () =>
    selectRadio(page, "是否AI作品", data.isAi ? "是" : "否"));
  if (data.isAi) {
    await runAction(`选择关联AIGC工具=${logValue(data.aigcTools)}`, () =>
      selectDropdownValues(page, "关联AIGC工具", data.aigcTools, recorder));
  }
  await runAction(`选择分类=${logValue(data.categories)}`, () =>
    selectDropdownValues(page, "分类", data.categories, recorder));
  await runAction(`选择男女频=${data.audience}`, () =>
    selectRadio(page, "男女频", data.audience));
  await runAction(`选择是否系列剧=${data.isSeries ? "是" : "否"}`, () =>
    selectRadio(page, "是否系列剧", data.isSeries ? "是" : "否"));
  if (data.isSeries) {
    await runAction("填写系列剧信息（季播剧，复用剧名、红果封面和简介）", () =>
      fillDouyinSeriesDialog(page, {
        coverFile: data.localHongguoCoverFile!,
        summary: data.summary,
        title: data.title,
      }));
  }
  await runAction(`选择版权专区IP改编=${data.isCopyrightIpAdaptation ? "是" : "否"}`, () =>
    selectRadio(page, "版权专区IP改编", data.isCopyrightIpAdaptation ? "是" : "否"));
  if (data.isCopyrightIpAdaptation && data.copyrightIpName) {
    await runAction(`选择版权IP=${logValue(data.copyrightIpName)}`, () =>
      selectSearchableDropdownByPlaceholder(
        page,
        "请选择已审核通过的IP申请记录",
        "copyrightIp",
        data.copyrightIpName!,
        recorder,
      ));
  }
  await runAction(`填写制作机构=${logValue(data.productionOrganization)}`, () =>
    fillInputById(page, "production_company_input", data.productionOrganization));
  await runAction(`填写制片人=${logValue(data.producers)}`, () =>
    fillInputById(page, "producer_input", data.producers.join("，")));
  await runAction(`填写导演=${logValue(data.directors)}`, () =>
    fillInputById(page, "director_input", data.directors.join("，")));
  if (data.screenwriters.length > 0) {
    await runAction(`填写编剧=${logValue(data.screenwriters)}`, () =>
      fillInputById(page, "script_writer_input", data.screenwriters.join("，")));
  }
  for (const [index, role] of data.roles.entries()) {
    await runAction(`添加角色[${index + 1}/${data.roles.length}]=${logValue(role.name)}`, () =>
      addDouyinRole(page, role));
  }
  await runAction(`选择制作金额范围=${DOUYIN_DRAMA_PRODUCTION_COST_RANGE}`, () =>
    selectRadio(page, "制作金额范围", DOUYIN_DRAMA_PRODUCTION_COST_RANGE));
  await runAction(`上传成本配置情况=${fileNames(data.costConfigurationFiles)}`, () =>
    uploadFormFiles(page, "成本配置情况", data.costConfigurationFiles));
  await runAction(`填写剧目制作成本=${data.productionCostWan}万元`, () =>
    fillStableInputById(page, "cost_price_input", data.productionCostWan));
  if (data.payCommitmentFiles.length > 0) {
    const payCommitmentItem = douyinFormItem(page, "片酬承诺书");
    if (await payCommitmentItem.isVisible().catch(() => false)) {
      await runAction(`上传片酬承诺书=${fileNames(data.payCommitmentFiles)}`, () =>
        uploadFormFiles(page, "片酬承诺书", data.payCommitmentFiles));
    } else {
      log(
        options,
        "[douyin-drama] 当前表单未展示片酬承诺书上传项，已跳过该可选材料",
        { files: fileNames(data.payCommitmentFiles) },
        "upload",
      );
    }
  }
  if (data.contractName) {
    await runAction(`选择绑定合同=${logValue(data.contractName)}`, () =>
      selectDropdownByPlaceholder(
        page,
        "请选择（温馨提示：合同绑定错误会影响结算）",
        "contract",
        data.contractName!,
        recorder,
      ));
  } else {
    await runAction("未指定合同，自动选择第一个可用合同并记录合同下拉", async () => {
      const selected = await selectFirstDropdownByPlaceholder(
        page,
        "请选择（温馨提示：合同绑定错误会影响结算）",
        "contract",
        recorder,
      );
      log(options, `[douyin-drama] 自动选择绑定合同：${selected}`, { selected }, "dropdown");
    });
  }
  await runAction(`上传权属文件=${fileNames(data.ownershipProofFiles)}`, () =>
    uploadFormFiles(page, "权属文件", data.ownershipProofFiles, 120_000, "copyright_files_input"));
  await runAction(`上传不侵权承诺函=${fileNames(data.nonInfringementCommitmentFiles)}`, () =>
    uploadFormFiles(
      page,
      "不侵权承诺函",
      data.nonInfringementCommitmentFiles,
      120_000,
      "non_infringement_letter_url_input",
    ));
  await runAction(`上传工程文件截图=${fileNames(data.projectScreenshotFiles)}`, () =>
    uploadFormFiles(
      page,
      "工程文件截图",
      data.projectScreenshotFiles,
      120_000,
      "engineering_file_screenshots_input",
    ));
  await runAction("基本信息点击下一步", () => clickDouyinNext(page));
}

async function uploadEpisodes(
  page: Page,
  task: ClaimedDouyinDramaTask,
  options: DouyinDramaRuntimeOptions,
  runAction: DouyinAutomationAction,
) {
  const uploadRootDir = options.assetDownloadDir ?? path.resolve(process.cwd(), ".drama-runs/douyin-drama/assets");
  await mkdir(uploadRootDir, { recursive: true });
  const prepared = await runAction(`准备剧集视频=${task.playlet.episodeCount}集`, () =>
    prepareEpisodeUploadFiles({
      localEpisodeVideoRoot: douyinDramaLocalRoot(options),
      resourceName: douyinDramaResourceName(task),
      uploadRootDir,
      uploadBaseName: task.playlet.title,
    }));
  try {
    await runAction(`选择并上传剧集视频=${prepared.files.length}个文件`, async () => {
      const panel = page.locator(".edit-page-video-upload-shortplay-container").filter({ visible: true }).first();
      await panel.waitFor({ state: "visible", timeout: 15_000 });
      const input = panel.locator('input[type="file"][multiple][accept*=".mp4"]').first();
      await input.waitFor({ state: "attached", timeout: 15_000 });
      await input.setInputFiles(prepared.files, { timeout: 120_000 });
    });
    const timeout = Math.max(1, options.episodeUploadWaitTimeoutMinutes ?? 120) * 60_000;
    await runAction(`等待${prepared.files.length}集上传完成，超时=${timeout / 60_000}分钟`, async () => {
      const panel = page.locator(".edit-page-video-upload-shortplay-container").filter({ visible: true }).first();
      const deadline = Date.now() + timeout;
      let lastStatus = "";
      let settledPasses = 0;
      while (Date.now() < deadline) {
        await assertNoDouyinFormError(page, "等待剧集上传完成");
        const text = (await panel.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
        const countMatch = text.match(/正片数量[·・]?\s*(\d+)/);
        const visibleCount = countMatch ? Number(countMatch[1]) : 0;
        const busy = /上传中|处理中|转码中|等待上传|解析中|重试/.test(text) ||
          (await panel.locator("[role='progressbar'], .arco-progress").count()) > 0;
        const failed = /上传失败|处理失败|转码失败|上传异常/.test(text);
        if (failed) throw new Error(`DOUYIN_DRAMA_EPISODE_UPLOAD_FAILED: ${text.slice(0, 500)}`);
        const status = `已出现=${visibleCount}/${prepared.files.length}，处理中=${busy ? "是" : "否"}`;
        if (status !== lastStatus) {
          lastStatus = status;
          log(options, `[douyin-drama] 剧集上传进度：${status}`, undefined, "automation");
        }
        settledPasses = visibleCount === prepared.files.length && !busy ? settledPasses + 1 : 0;
        if (settledPasses >= 2) return;
        await page.waitForTimeout(episodeUploadPollIntervalMs);
      }
      throw new Error(
        `DOUYIN_DRAMA_EPISODE_UPLOAD_TIMEOUT: timeoutMinutes=${timeout / 60_000}; ${lastStatus}`,
      );
    });
  } finally {
    await runAction("清理剧集上传临时文件", () => cleanupEpisodeUploadFiles(prepared));
  }
  if (!task.playlet.localDouyinCoverFile) {
    throw new Error("DOUYIN_DRAMA_BATCH_EDIT_COVER_REQUIRED");
  }
  await runAction(
    `批量编辑剧集=第1集至第${task.playlet.episodeCount}集，标题=${logValue(task.playlet.title)}`,
    () => fillDouyinEpisodeBatchEdit(page, {
      coverFile: task.playlet.localDouyinCoverFile!,
      episodeCount: task.playlet.episodeCount,
      title: task.playlet.title,
    }),
  );
  await runAction("视频上传页点击下一步", () => clickDouyinNext(page));
}

async function fillPublishConfiguration(
  page: Page,
  task: ClaimedDouyinDramaTask,
  runAction: DouyinAutomationAction,
  recorder: DouyinDramaDropdownRecorder,
) {
  const data = task.playlet;
  await runAction(`设置发布时间=${logValue(data.scheduledPublishAt)}`, () =>
    fillDouyinPublishDateTime(page, data.scheduledPublishAt));
  const brandAccountPlaceholder = "请选择（选择授权中的红果厂牌账号，仅支持选1个）";
  if (data.brandAccountName) {
    await runAction(`选择红果厂牌账号=${logValue(data.brandAccountName)}`, () =>
      selectDropdownByPlaceholder(
        page,
        brandAccountPlaceholder,
        "brandAccount",
        data.brandAccountName!,
        recorder,
      ));
  } else {
    await runAction("未指定红果厂牌账号，选择第一个可用厂牌账号并记录下拉", async () => {
      const selected = await selectFirstDropdownByPlaceholder(
        page,
        brandAccountPlaceholder,
        "brandAccount",
        recorder,
      );
      return selected;
    });
  }
  await runAction(`选择发布方式=${data.publishMode}`, () =>
    selectVisibleRadio(page, data.publishMode));
  if (data.publishMode === "自主发布") {
    const placeholder = "请选择（B号每日正片发布限额2000，C号每日正片发布限额75）";
    if (data.publishAccountName) {
      await runAction(`选择发布账号=${logValue(data.publishAccountName)}`, () =>
        selectSearchableDropdownByPlaceholder(
          page,
          placeholder,
          "publishAccount",
          data.publishAccountName!,
          recorder,
        ));
    } else {
      await runAction("未指定发布账号，选择第一个可用账号并记录下拉", async () => {
        const selected = await selectFirstDropdownByPlaceholder(
          page,
          placeholder,
          "publishAccount",
          recorder,
        );
        return selected;
      });
    }
  }
  await runAction("进入销售配置表单", () => enterSalesConfiguration(page));
}

export async function enterSalesConfiguration(page: Page) {
  const salesConfiguration = page.locator(salesConfigurationSelector).filter({ visible: true });
  if (await salesConfiguration.count() > 0) return;

  // 抖音同时存在同页表单和旧版分步表单。仅在销售字段尚未出现时推进到下一步，
  // 避免同页表单已经渲染后仍等待一个不存在的“下一步”按钮。
  await clickDouyinNext(page);
  await salesConfiguration.first().waitFor({ state: "visible", timeout: 15_000 });
}

async function fillSalesConfiguration(
  page: Page,
  task: ClaimedDouyinDramaTask,
  options: DouyinDramaRuntimeOptions,
  runAction: DouyinAutomationAction,
) {
  const unitPriceYuan = task.playlet.unitPriceYuan ?? options.unitPriceYuan ?? 0.5;
  const paidEpisodeStart = task.playlet.paidEpisodeStart ?? options.paidEpisodeStart ?? 10;
  if (!Number.isFinite(unitPriceYuan) || unitPriceYuan < 0.1 || unitPriceYuan > 9_999) {
    throw new Error(`DOUYIN_DRAMA_UNIT_PRICE_INVALID: ${unitPriceYuan}`);
  }

  await runAction("设置最近可用的更新完成时间", () =>
    fillNearestDouyinCompletionPromiseDateTime(page));
  await runAction(`填写单集售价=${unitPriceYuan}元`, () =>
    fillStableInputById(page, "unit_price_input", unitPriceYuan));
  await runAction(
    `选择售卖集数=第${paidEpisodeStart}集至第${task.playlet.episodeCount}集`,
    () => selectDouyinChargeEpisodes(page, paidEpisodeStart, task.playlet.episodeCount),
  );
}

export async function waitForDouyinSubmitSuccess(
  page: Page,
  submittedAt: number,
  options: { settleMs?: number; timeoutMs?: number } = {},
) {
  const settleMs = options.settleMs ?? postSubmitSettleMs;
  const timeoutMs = options.timeoutMs ?? 90_000;
  const deadline = submittedAt + timeoutMs;
  let verified = false;
  while (Date.now() < deadline) {
    await assertNoDouyinFormError(page, "提交抖音漫剧");
    const activeUrl = new URL(page.url());
    const returnedToManagement = activeUrl.hostname === "www.shortdramas.com"
      && activeUrl.pathname.startsWith("/page/copyright/book-manage");
    const successMessage = await page.locator([
      ".arco-message-success:visible",
      ".arco-result-success:visible",
      "[role='alert']:visible",
    ].join(", ")).filter({
      hasText: /提交成功|上传成功|已提交|提交完成|创建成功/,
    }).first().isVisible().catch(() => false);
    verified ||= returnedToManagement || successMessage;
    if (verified && Date.now() - submittedAt >= settleMs) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`DOUYIN_DRAMA_SUBMIT_SUCCESS_NOT_VERIFIED: url=${page.url()}`);
}

export async function runDouyinDramaPublishTask(
  page: Page,
  task: ClaimedDouyinDramaTask,
  options: DouyinDramaRuntimeOptions,
) {
  const runAction = createActionRunner(page, options);
  const recorder = createDouyinDramaDropdownRecorder(options);
  await recorder.record("initial-static-options", []);
  log(
    options,
    `[douyin-drama] 发布脚本开始：taskId=${task.accountTaskId}，剧名=${logValue(task.playlet.title)}`,
    { accountTaskId: task.accountTaskId, title: task.playlet.title },
    "publish",
  );
  try {
    await runAction(`打开抖音上传漫剧页=${DOUYIN_DRAMA_CREATE_URL}`, async () => {
      await page.goto(DOUYIN_DRAMA_CREATE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await waitForDouyinDramaCreatePageReady(page);
    });
    await runAction("检查并清空页面同步的上次填写内容", async () => {
      const reset = await resetRestoredDouyinFormIfPresent(page);
      if (reset) await waitForDouyinDramaCreatePageReady(page);
      log(
        options,
        reset
          ? "[douyin-drama] 已重置页面自动恢复的上次填写内容。"
          : "[douyin-drama] 页面没有恢复旧草稿，继续填写。",
        { accountTaskId: task.accountTaskId, reset },
        "automation",
      );
    });
    await fillBasicInformation(page, task, options, runAction, recorder);
    await uploadEpisodes(page, task, options, runAction);
    await fillPublishConfiguration(page, task, runAction, recorder);
    await fillSalesConfiguration(page, task, options, runAction);

    if (!task.playlet.submit) {
      log(
        options,
        "[douyin-drama] 发布脚本完成：submit=false，已填写并上传，停留在提交确认页。",
        { accountTaskId: task.accountTaskId, submitted: false },
        "publish",
      );
      return;
    }
    await runAction("提交抖音漫剧", async () => {
      const submitButton = page
        .getByRole("button", { name: /提交|确认提交|完成/ })
        .filter({ visible: true })
        .last();
      await submitButton.waitFor({ state: "visible", timeout: 15_000 });
      const submittedAt = Date.now();
      await submitButton.click();
      const confirm = page
        .getByRole("button", { name: /确定|确认提交/ })
        .filter({ visible: true })
        .last();
      if (await confirm.waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false)) {
        await confirm.click();
      }
      await waitForDouyinSubmitSuccess(page, submittedAt);
    });
    log(
      options,
      "[douyin-drama] 发布脚本完成：已提交。",
      { accountTaskId: task.accountTaskId, submitted: true },
      "publish",
    );
  } catch (error) {
    errorLog(
      options,
      `[douyin-drama] 发布脚本失败：taskId=${task.accountTaskId}；url=${page.url()}；错误=${errorMessage(error)}`,
      { accountTaskId: task.accountTaskId, url: page.url(), error },
      "publish",
    );
    throw error;
  }
}
