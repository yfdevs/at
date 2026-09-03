import type { BrowserContext, Page } from "playwright";

import { iqiyiCreateUrl } from "../shared/constants.js";
import { log } from "../shared/logger.js";
import type { PreparedIqiyiMaterials } from "../shared/materials.js";
import { resolveIqiyiRecommendation } from "../shared/recommendation.js";
import type {
  ClaimedIqiyiDramaTask,
  IqiyiDramaRuntimeOptions,
  IqiyiDramaType,
} from "../shared/types.js";
import {
  iqiyiDramaLoginStateFromUrl,
  saveCredentialState,
  waitForIqiyiLogin,
} from "./browser-session.js";
import {
  clickIqiyiButton,
  fillIqiyiField,
  openIqiyiSection,
  selectFirstIqiyiOption,
  throwIfIqiyiFormInvalid,
  uploadIqiyiFiles,
} from "./form-controls.js";
import { uploadIqiyiEpisodeVideos } from "./video-upload.js";

async function waitForCreateForm(page: Page) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const controls = await page.locator("form input:not([type='hidden']),form textarea,[class*='form'] input")
      .filter({ visible: true }).count();
    if (controls > 0) return;
    await page.waitForTimeout(500);
  }
  const text = (await page.locator("body").innerText().catch(() => ""))
    .replace(/\s+/g, " ").trim().slice(0, 400);
  throw new Error(`IQIYI_DRAMA_CREATE_FORM_NOT_READY: url=${page.url()}; pageText=${text || "空"}`);
}

function scheduledOnlineTimeAfterOneDay(now = new Date()) {
  const scheduled = new Date(now);
  scheduled.setDate(scheduled.getDate() + 1);
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    `${scheduled.getFullYear()}-${pad(scheduled.getMonth() + 1)}-${pad(scheduled.getDate())}`,
    `${pad(scheduled.getHours())}:${pad(scheduled.getMinutes())}:${pad(scheduled.getSeconds())}`,
  ].join(" ");
}

function releaseDateFor(now = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

export async function fillIqiyiPaymentFields(
  page: Page,
  options: IqiyiDramaRuntimeOptions,
  payload: ClaimedIqiyiDramaTask["playlet"],
) {
  const isShortDrama = payload.dramaType === "short-drama";
  await fillIqiyiField(page, options, {
    aliases: ["付费状态", "是否付费"],
    value: isShortDrama ? payload.paymentStatus : "免费",
    kind: "radio",
    required: true,
  });
  if (!isShortDrama || payload.paymentStatus !== "付费") return;

  await fillIqiyiField(page, options, {
    aliases: ["是否可转免"],
    value: payload.convertibleToFree,
    kind: "choice",
    required: true,
  });
  await fillIqiyiField(page, options, {
    aliases: ["开始付费集"],
    value: payload.paidStartEpisode,
    required: true,
  });
}

async function confirmIqiyiNoCompanySelection(page: Page) {
  const dialog = page.locator("[role='dialog'],.mp-modal,.mp-dialog,.ant-modal,.el-dialog")
    .filter({ hasText: /无制作方|无联合出品方|不可更改|确认/u, visible: true })
    .last();
  if (!(await dialog.waitFor({ state: "visible", timeout: 3_000 }).then(() => true, () => false))) {
    return;
  }
  const confirm = dialog.getByRole("button", { name: /^(确定|确认)$/u })
    .filter({ visible: true })
    .last();
  await confirm.waitFor({ state: "visible", timeout: 5_000 });
  await confirm.click({ force: true, timeout: 5_000 });
}

export async function fillIqiyiNoCompanyFields(
  page: Page,
  options: IqiyiDramaRuntimeOptions,
  dramaType: IqiyiDramaType,
) {
  await fillIqiyiField(page, options, {
    aliases: ["制作方"],
    value: "无制作方",
    kind: "choice",
    required: true,
  });
  await confirmIqiyiNoCompanySelection(page);

  if (dramaType !== "short-drama") return;

  await fillIqiyiField(page, options, {
    aliases: ["联合出品方"],
    value: "无联合出品方",
    kind: "choice",
    required: true,
  });
  await confirmIqiyiNoCompanySelection(page);
}

export async function openIqiyiCreatePage(
  page: Page,
  context: BrowserContext,
  task: ClaimedIqiyiDramaTask,
  options: IqiyiDramaRuntimeOptions,
) {
  const targetUrl = iqiyiCreateUrl(task.playlet.dramaType);
  const navigate = () => page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await navigate();
  await page.waitForTimeout(1_000);
  if (iqiyiDramaLoginStateFromUrl(page.url()) !== "logged-in") {
    await waitForIqiyiLogin(page, context, options);
    await navigate();
  }
  if (iqiyiDramaLoginStateFromUrl(page.url()) !== "logged-in") {
    throw new Error(`IQIYI_DRAMA_LOGIN_REQUIRED: url=${page.url()}`);
  }
  await waitForCreateForm(page);
  await saveCredentialState(context, options).catch(() => undefined);
}

export async function runIqiyiPublishTask(
  page: Page,
  context: BrowserContext,
  task: ClaimedIqiyiDramaTask,
  options: IqiyiDramaRuntimeOptions,
  materials: PreparedIqiyiMaterials,
) {
  const payload = task.playlet;
  const recommendation = await resolveIqiyiRecommendation(payload, options);
  await openIqiyiCreatePage(page, context, task, options);
  log(
    options,
    `[iqiyi-drama] filling ${payload.dramaType} project: accountTaskId=${task.accountTaskId}`,
  );
  const isShortDrama = payload.dramaType === "short-drama";
  const taskRunTime = new Date();

  if (isShortDrama) {
    await fillIqiyiField(page, options, {
      aliases: ["成片状态"],
      value: "成片",
      kind: "radio",
      required: true,
    });
    await fillIqiyiField(page, options, {
      aliases: ["上线类型"],
      value: "全集",
      kind: "radio",
      required: true,
    });
    await fillIqiyiField(page, options, {
      aliases: ["制作声明"],
      value: "含AI生成内容",
      kind: "radio",
      required: true,
    });
    await fillIqiyiField(page, options, {
      aliases: ["是否纳逗Pro专区IP", "是否纳逗 Pro 专区 IP"],
      value: "否",
      kind: "radio",
      required: true,
    });
  }

  const filledProductionCostYuan = await fillIqiyiField(page, options, {
    aliases: ["制作成本", "制作成本（元）", "制作成本(元)", "项目制作成本", "项目制作成本（元）"],
    placeholders: ["请填写9位以内的数字（单位：元）"],
    value: payload.productionCostYuan,
  });
  if (!filledProductionCostYuan) {
    await fillIqiyiField(page, options, {
      aliases: ["制作成本（万元）", "制作成本(万元)", "项目制作成本（万元）", "项目制作成本(万元)"],
      value: payload.productionCostYuan / 10_000,
      required: true,
    });
  }
  await fillIqiyiField(page, options, {
    aliases: ["定时上线"],
    value: scheduledOnlineTimeAfterOneDay(taskRunTime),
    kind: "date",
    required: true,
  });
  await fillIqiyiField(page, options, {
    aliases: ["发行日期"],
    value: releaseDateFor(taskRunTime),
    kind: "date",
    required: true,
  });
  await openIqiyiSection(page, "资质文件");
  await fillIqiyiField(page, options, {
    aliases: ["出品方"],
    value: payload.productionOrganization,
    required: true,
  });
  await uploadIqiyiFiles(page, options, {
    aliases: ["知识产权声明文件"],
    files: payload.copyright.productionProofFiles,
    required: true,
  });
  await uploadIqiyiFiles(page, options, {
    aliases: ["版权证明文件"],
    files: materials.copyrightProofFiles,
    required: true,
  });
  await fillIqiyiNoCompanyFields(page, options, payload.dramaType);
  await openIqiyiSection(page, "作品内容");
  await fillIqiyiField(page, options, {
    aliases: ["标题", "剧名", "项目名称", "作品名称", "专辑名称"],
    value: payload.title,
    required: true,
  });
  await fillIqiyiField(page, options, {
    aliases: ["一句话推荐"],
    value: recommendation,
    required: true,
  });
  await fillIqiyiField(page, options, {
    aliases: ["简介", "剧情简介", "作品简介", "项目简介", "故事梗概"],
    value: payload.summary,
    kind: "textarea",
    required: true,
  });
  await fillIqiyiField(page, options, {
    aliases: ["总集数", "集数", "计划集数"],
    value: payload.episodeCount,
    required: true,
  });
  if (!isShortDrama) {
    await fillIqiyiField(page, options, {
      aliases: ["上线类型"],
      value: "全集",
      kind: "radio",
      required: true,
    });
  }
  await fillIqiyiPaymentFields(page, options, payload);
  await fillIqiyiField(page, options, {
    aliases: isShortDrama ? ["分类"] : ["受众类型", "目标受众", "受众"],
    value: payload.audienceType,
    kind: "choice",
    required: true,
  });
  if (!isShortDrama) {
    await fillIqiyiField(page, options, {
      aliases: ["画面"],
      value: payload.visualType,
      kind: "choice",
      required: true,
    });
    await fillIqiyiField(page, options, {
      aliases: ["内容来源"],
      value: payload.contentSource,
      kind: "choice",
      required: true,
    });
    if (payload.secondaryCategories.length === 0) {
      throw new Error("IQIYI_DRAMA_REQUIRED_FIELD_VALUE_MISSING: 大标签");
    }
    for (const category of payload.secondaryCategories) {
      await fillIqiyiField(page, options, {
        aliases: ["大标签", "内容标签", "标签", "二级分类"],
        value: category,
        kind: "choice",
        required: true,
      });
    }
  } else {
    const tags = [...new Set(payload.secondaryCategories)];
    if (tags.length === 0) {
      throw new Error("IQIYI_DRAMA_REQUIRED_FIELD_VALUE_MISSING: 标签");
    }
    for (const tag of tags) {
      await fillIqiyiField(page, options, {
        aliases: ["标签"],
        value: tag,
        kind: "choice",
        required: true,
      });
    }
  }
  await uploadIqiyiFiles(page, options, {
    aliases: ["封面编辑", "封面"],
    files: [payload.horizontalCoverFile!, payload.verticalCoverFile!],
    required: true,
    settleCoverEditor: true,
  });

  await openIqiyiSection(page, "上传正片");
  await uploadIqiyiEpisodeVideos(page, task, options);

  await openIqiyiSection(page, "签约意向");
  await selectFirstIqiyiOption(page, options, {
    aliases: ["签约意向"],
    placeholders: ["请选择签约意向"],
    required: true,
  });

  await throwIfIqiyiFormInvalid(page);
  const clicked = await clickIqiyiButton(page, ["提交项目"]);
  if (!clicked) throw new Error("IQIYI_DRAMA_SUBMIT_BUTTON_NOT_FOUND");
  await page.waitForTimeout(2_000);
  await throwIfIqiyiFormInvalid(page);
  log(options, `[iqiyi-drama] clicked project action: ${clicked}`);
  await saveCredentialState(context, options).catch(() => undefined);
}
