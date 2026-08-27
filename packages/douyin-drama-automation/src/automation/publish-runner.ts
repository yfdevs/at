import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  cleanupEpisodeUploadFiles,
  prepareEpisodeUploadFiles,
} from "@drama/drama-media-assets";
import type { Page } from "playwright";
import { DOUYIN_DRAMA_CREATE_URL } from "../shared/constants.js";
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
  fillInputById,
  selectDropdownByPlaceholder,
  selectDropdownValues,
  selectFirstDropdownByPlaceholder,
  selectRadio,
  selectVisibleRadio,
  uploadFormFiles,
} from "./form-controls.js";

type DouyinAutomationAction = <T>(name: string, action: () => Promise<T>) => Promise<T>;

const episodeUploadPollIntervalMs = 5_000;
const postSubmitSettleMs = 10_000;

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
      const result = await action();
      log(options, `[douyin-drama] 脚本操作完成：${name}`, { action: name, url: page.url() }, "automation");
      return result;
    } catch (error) {
      errorLog(
        options,
        `[douyin-drama] 脚本操作失败：${name}；url=${page.url()}；错误=${errorMessage(error)}`,
        { action: name, url: page.url(), error },
        "automation",
      );
      throw error;
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
  await runAction(`填写站外付费别名=${logValue(data.outsideSaleAlias)}`, () =>
    fillInputById(page, "outside_sale_alias_input", data.outsideSaleAlias));
  await runAction(`填写站外免费别名=${logValue(data.outsideFreeAlias)}`, () =>
    fillInputById(page, "outside_free_alias_input", data.outsideFreeAlias));
  await runAction(`填写承诺总集数=${data.episodeCount}`, () =>
    fillInputById(page, "final_chapter_number_input", data.episodeCount));
  await runAction(`选择更新状态=${data.updateStatus}`, () =>
    selectRadio(page, "更新状态", data.updateStatus));
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
  await runAction(`选择版权专区IP改编=${data.isCopyrightIpAdaptation ? "是" : "否"}`, () =>
    selectRadio(page, "版权专区IP改编", data.isCopyrightIpAdaptation ? "是" : "否"));
  if (data.isCopyrightIpAdaptation && data.copyrightIpName) {
    await runAction(`选择版权IP=${logValue(data.copyrightIpName)}`, () =>
      selectDropdownByPlaceholder(
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
  await runAction(`填写编剧=${logValue(data.screenwriters)}`, () =>
    fillInputById(page, "script_writer_input", data.screenwriters.join("，")));
  for (const [index, role] of data.roles.entries()) {
    await runAction(`添加角色[${index + 1}/${data.roles.length}]=${logValue(role.name)}`, () =>
      addDouyinRole(page, role));
  }
  await runAction(`选择制作金额范围=${data.productionCostRange}`, () =>
    selectRadio(page, "制作金额范围", data.productionCostRange));
  await runAction(`上传成本配置情况=${fileNames(data.costConfigurationFiles)}`, () =>
    uploadFormFiles(page, "成本配置情况", data.costConfigurationFiles));
  await runAction(`填写剧目制作成本=${data.productionCostWan}万元`, () =>
    fillInputById(page, "cost_price_input", data.productionCostWan));
  if (data.payCommitmentFiles.length > 0) {
    await runAction(`上传片酬承诺书=${fileNames(data.payCommitmentFiles)}`, () =>
      uploadFormFiles(page, "片酬承诺书", data.payCommitmentFiles));
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
  } else if (data.useFirstAvailableContract) {
    await runAction("选择第一个可用合同并记录合同下拉", async () => {
      const selected = await selectFirstDropdownByPlaceholder(
        page,
        "请选择（温馨提示：合同绑定错误会影响结算）",
        "contract",
        recorder,
      );
      log(options, `[douyin-drama] 测试任务自动选择合同：${selected}`, { selected }, "dropdown");
    });
  }
  await runAction(`上传权属文件=${fileNames(data.ownershipProofFiles)}`, () =>
    uploadFormFiles(page, "权属文件", data.ownershipProofFiles));
  await runAction(`上传不侵权承诺函=${fileNames(data.nonInfringementCommitmentFiles)}`, () =>
    uploadFormFiles(page, "不侵权承诺函", data.nonInfringementCommitmentFiles));
  await runAction(`上传工程文件截图=${fileNames(data.projectScreenshotFiles)}`, () =>
    uploadFormFiles(page, "工程文件截图", data.projectScreenshotFiles));
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
  await runAction("视频上传页点击下一步", () => clickDouyinNext(page));
}

async function fillPublishConfiguration(
  page: Page,
  task: ClaimedDouyinDramaTask,
  runAction: DouyinAutomationAction,
  recorder: DouyinDramaDropdownRecorder,
) {
  const data = task.playlet;
  if (data.scheduledPublishAt) {
    await runAction(`填写定时发布时间=${data.scheduledPublishAt}`, async () => {
      const input = page
        .getByPlaceholder("请选择（最早支持设置+72小时的发布时间）", { exact: true })
        .filter({ visible: true })
        .first();
      await input.fill(data.scheduledPublishAt!);
      await input.press("Enter");
    });
  }
  if (data.brandAccountName) {
    await runAction(`选择红果厂牌账号=${logValue(data.brandAccountName)}`, () =>
      selectDropdownByPlaceholder(
        page,
        "请选择（选择授权中的红果厂牌账号，仅支持选1个）",
        "brandAccount",
        data.brandAccountName!,
        recorder,
      ));
  }
  await runAction(`选择发布方式=${data.publishMode}`, () =>
    selectVisibleRadio(page, data.publishMode));
  await runAction("发布配置页点击下一步", () => clickDouyinNext(page));
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
    await fillBasicInformation(page, task, options, runAction, recorder);
    await uploadEpisodes(page, task, options, runAction);
    await fillPublishConfiguration(page, task, runAction, recorder);

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
      await submitButton.click();
      const confirm = page
        .getByRole("button", { name: /确定|确认提交/ })
        .filter({ visible: true })
        .last();
      if (await confirm.waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false)) {
        await confirm.click();
      }
      await page.waitForTimeout(postSubmitSettleMs);
      await assertNoDouyinFormError(page, "提交抖音漫剧");
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
