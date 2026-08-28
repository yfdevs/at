import type { BrowserContext, Page } from "playwright";

import { iqiyiCreateUrl } from "../shared/constants.js";
import { log } from "../shared/logger.js";
import type { ClaimedIqiyiDramaTask, IqiyiDramaRuntimeOptions } from "../shared/types.js";
import {
  iqiyiDramaLoginStateFromUrl,
  saveCredentialState,
  waitForIqiyiLogin,
} from "./browser-session.js";
import {
  clickIqiyiButton,
  fillIqiyiField,
  fillIqiyiSearchPeople,
  fillIqiyiSimplePeople,
  fillIqiyiTags,
  openIqiyiSection,
  throwIfIqiyiFormInvalid,
  uploadIqiyiFiles,
} from "./form-controls.js";

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
  if (iqiyiDramaLoginStateFromUrl(page.url()) === "login-required") {
    await waitForIqiyiLogin(page, context, options);
    await navigate();
  }
  await waitForCreateForm(page);
  await saveCredentialState(context, options).catch(() => undefined);
}

export async function runIqiyiPublishTask(
  page: Page,
  context: BrowserContext,
  task: ClaimedIqiyiDramaTask,
  options: IqiyiDramaRuntimeOptions,
) {
  await openIqiyiCreatePage(page, context, task, options);
  const payload = task.playlet;
  log(
    options,
    `[iqiyi-drama] filling ${payload.dramaType} project: accountTaskId=${task.accountTaskId}`,
  );
  const isShortDrama = payload.dramaType === "short-drama";

  if (isShortDrama) {
    await fillIqiyiField(page, options, {
      aliases: ["成片状态"],
      value: "未成片",
      kind: "radio",
      required: true,
    });
    await fillIqiyiField(page, options, {
      aliases: ["制作声明"],
      value: payload.isAiGenerated === "是" ? "含AI生成内容" : "无需声明",
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

  await fillIqiyiSearchPeople(page, options, {
    aliases: ["导演"],
    values: payload.directors,
    inputPlaceholder: "请输入名称搜索并选择对应人物",
    addButtonNames: ["增加导演"],
    required: isShortDrama,
  });
  await fillIqiyiSearchPeople(page, options, {
    aliases: ["主要演员", "主演", "演员"],
    values: payload.actors,
    inputPlaceholder: "请输入名称搜索并选择对应人物",
    addButtonNames: ["增加主要演员", "增加演员"],
    required: isShortDrama && payload.isAiGenerated !== "是",
  });
  await fillIqiyiSimplePeople(page, options, {
    aliases: ["制片人"],
    values: payload.producers,
    inputPlaceholder: "请输入制片人姓名",
    addButtonNames: ["增加制片人"],
    required: isShortDrama,
  });
  await fillIqiyiTags(page, options, {
    aliases: ["编剧"],
    values: payload.screenwriters,
    required: isShortDrama,
  });
  await fillIqiyiField(page, options, {
    aliases: ["制作成本"],
    value: payload.productionCostYuan,
    required: true,
  });
  await fillIqiyiField(page, options, {
    aliases: ["定时上线"],
    value: payload.scheduledOnlineTime,
    kind: "date",
    required: true,
  });
  await fillIqiyiField(page, options, {
    aliases: ["发行日期"],
    value: payload.releaseDate,
    kind: "date",
    required: true,
  });
  await fillIqiyiField(page, options, {
    aliases: ["备案号"],
    value: payload.licenseNumber,
  });

  await openIqiyiSection(page, "资质文件");
  await fillIqiyiField(page, options, {
    aliases: ["出品方"],
    value: payload.productionOrganization,
    required: true,
  });
  await uploadIqiyiFiles(page, options, {
    aliases: ["版权证明文件", "出品方"],
    files: payload.ownershipFiles,
    required: true,
  });
  await fillIqiyiField(page, options, {
    aliases: ["制作方"],
    value: "无制作方",
    kind: "choice",
    required: true,
  });
  const companyDialog = page.locator("[role='dialog'],.mp-modal,.mp-dialog,.ant-modal,.el-dialog")
    .filter({ hasText: /无制作方|不可更改|确认/, visible: true }).last();
  if (await companyDialog.count() > 0) {
    await companyDialog.getByRole("button", { name: /^(确定|确认)$/ })
      .filter({ visible: true }).last().click({ timeout: 10_000 });
  }
  await fillIqiyiField(page, options, {
    aliases: ["联合出品方"],
    value: "无联合出品方",
    kind: "choice",
  });

  await openIqiyiSection(page, "作品内容");
  if (!isShortDrama) {
    await fillIqiyiField(page, options, {
      aliases: ["成片状态", "作品状态"],
      value: "未成片",
      kind: "radio",
      required: true,
    });
  }

  await fillIqiyiField(page, options, {
    aliases: ["标题", "剧名", "项目名称", "作品名称", "专辑名称"],
    value: payload.title,
    required: true,
  });
  await fillIqiyiField(page, options, {
    aliases: ["一句话推荐"],
    value: payload.shortDescription,
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
    required: !isShortDrama,
  });
  await fillIqiyiField(page, options, {
    aliases: ["受众类型", "目标受众", "受众"],
    value: payload.audienceType,
    kind: "choice",
  });
  await fillIqiyiField(page, options, {
    aliases: ["题材", "一级分类", "作品类型", "项目类型"],
    value: payload.primaryCategory,
    kind: "select",
  });
  for (const category of payload.secondaryCategories) {
    await fillIqiyiField(page, options, {
      aliases: ["内容标签", "标签", "二级分类"],
      value: category,
      kind: "choice",
    });
  }
  await fillIqiyiField(page, options, {
    aliases: ["上线类型"],
    value: "全集",
    kind: "radio",
  });
  await fillIqiyiField(page, options, {
    aliases: ["付费状态", "是否付费"],
    value: "免费",
    kind: "radio",
  });
  await fillIqiyiField(page, options, {
    aliases: ["改编来源", "IP 来源", "原著名称"],
    value: payload.adaptationSource,
  });
  await uploadIqiyiFiles(page, options, {
    aliases: ["封面编辑", "封面"],
    files: [payload.horizontalCoverFile!, payload.verticalCoverFile!],
    required: true,
    settleCoverEditor: true,
  });

  await throwIfIqiyiFormInvalid(page);
  const clicked = payload.submit
    ? await clickIqiyiButton(page, ["提交项目", "提交审核", "创建并提交"])
    : await clickIqiyiButton(page, ["保存项目", "保存草稿", "暂存"]);
  if (!clicked) throw new Error(
    payload.submit ? "IQIYI_DRAMA_SUBMIT_BUTTON_NOT_FOUND" : "IQIYI_DRAMA_SAVE_BUTTON_NOT_FOUND",
  );
  if (clicked) {
    await page.waitForTimeout(2_000);
    await throwIfIqiyiFormInvalid(page);
    log(options, `[iqiyi-drama] clicked project action: ${clicked}`);
  }
  await saveCredentialState(context, options).catch(() => undefined);
}
