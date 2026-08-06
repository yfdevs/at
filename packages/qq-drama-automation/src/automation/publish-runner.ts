import type { BrowserContext, Page } from "playwright";
import { QQ_DRAMA_ADD_URL } from "../shared/constants.js";
import { log } from "../shared/logger.js";
import type { ClaimedQqDramaTask, QqDramaRuntimeOptions } from "../shared/types.js";
import {
  qqDramaLoginStateFromUrl,
  saveCredentialState,
  waitForLoginIfNeeded,
} from "./browser-session.js";
import { fillBasicInfoStep } from "./steps/basic-info.js";
import { confirmAndSubmitStep } from "./steps/confirm.js";
import { uploadEpisodeVideosStep } from "./steps/episodes.js";
import { qqPageMessageErrorLocator } from "./steps/form-controls.js";

export async function openQqDramaAddPage(
  page: Page,
  context: BrowserContext,
  options: QqDramaRuntimeOptions,
) {
  async function gotoAddPage() {
    await page.goto(QQ_DRAMA_ADD_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(1_000);
  }

  async function waitForBasicInfoPageReady() {
    let deadline = Date.now() + 60_000;
    const titleInput = page
      .locator("input[placeholder*='审核通过后不支持修改'],input[placeholder*='作品名称']")
      .filter({ visible: true })
      .first();

    while (Date.now() < deadline) {
      if (await titleInput.count() > 0) return;

      if (qqDramaLoginStateFromUrl(page.url()) === "login-required") {
        await waitForLoginIfNeeded(page, context, options);
        await gotoAddPage();
        deadline = Date.now() + 60_000;
        continue;
      }

      await page.waitForTimeout(500);
    }

    const pageText = (await page.locator("body").innerText().catch(() => ""))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);
    throw new Error(
      `QQ_DRAMA_BASIC_INFO_NOT_READY: 等待作品名称输入框显示超时；url=${page.url()}; pageText=${pageText || "空"}`,
    );
  }

  await gotoAddPage();
  if (qqDramaLoginStateFromUrl(page.url()) === "login-required") {
    await waitForLoginIfNeeded(page, context, options);
    await gotoAddPage();
  }
  await waitForBasicInfoPageReady();

  await saveCredentialState(context, options).catch(() => undefined);
}

export async function runQqDramaPublishTask(
  page: Page,
  context: BrowserContext,
  task: ClaimedQqDramaTask,
  options: QqDramaRuntimeOptions,
) {
  log(options, `[qq-drama] opening add page for accountTaskId=${task.accountTaskId}`);
  await openQqDramaAddPage(page, context, options);

  const messageErrors = qqPageMessageErrorLocator(page);
  await page.addLocatorHandler(
    messageErrors,
    async (messages) => {
      const texts = [
        ...new Set(
          (await messages.allInnerTexts())
            .map((text) => text.replace(/\s+/g, " ").trim())
            .filter(Boolean),
        ),
      ];
      throw new Error(`QQ_DRAMA_PAGE_MESSAGE: ${texts.join("；") || "QQ 页面出现错误提示"}`);
    },
    { noWaitAfter: true },
  );

  try {
    log(options, `[qq-drama] start basic info step: accountTaskId=${task.accountTaskId}`);
    await fillBasicInfoStep(page, task, options);

    log(options, `[qq-drama] start episode upload step: accountTaskId=${task.accountTaskId}`);
    await uploadEpisodeVideosStep(page, task, options);

    log(options, `[qq-drama] start confirm step: accountTaskId=${task.accountTaskId}`);
    await confirmAndSubmitStep(page, task, options);

    await saveCredentialState(context, options).catch(() => undefined);
  } finally {
    await page.removeLocatorHandler(messageErrors).catch(() => undefined);
  }
}
