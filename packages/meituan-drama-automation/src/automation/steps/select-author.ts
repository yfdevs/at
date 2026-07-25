import type { Page } from "playwright";
import type {
  MeituanCreationRuntimeOptions,
  MeituanCreationTaskConfig,
} from "../../shared/types.js";
import { log } from "../browser-session.js";
import { clickWhenReady } from "../form-controls.js";
import { fillCreateCollectionDrawer } from "./create-collection.js";

async function selectAuthor(
  page: Page,
  taskConfig: MeituanCreationTaskConfig,
  options: MeituanCreationRuntimeOptions,
) {
  log(options, "[meituan-drama] selecting author");

  const authorTextbox = page.getByRole("textbox", { name: "请选择名下作者昵称" });
  await authorTextbox.waitFor({ state: "visible", timeout: 60_000 });
  await authorTextbox.click({ timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await authorTextbox.click({ timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  const authorOption = page
    .locator(".czz-author-selector-item")
    .filter({ hasText: taskConfig.authorNicknameText });
  await clickWhenReady(page, authorOption);
}

async function selectCollection(
  page: Page,
  taskConfig: MeituanCreationTaskConfig,
  options: MeituanCreationRuntimeOptions,
  copyrightProofFiles: string[],
) {
  log(options, "[meituan-drama] selecting collection");

  const collectionTextbox = page.getByRole("textbox", { name: "选择或创建合集" });
  const createCollection = page
    .getByText("创建新合集", { exact: true })
    .filter({ visible: true })
    .last();
  const drawerReady = page.getByRole("textbox", { name: "选择合集类型" });
  await collectionTextbox.waitFor({ state: "visible", timeout: 60_000 });

  let drawerOpened = false;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await collectionTextbox.click({ timeout: 30_000 });
    await createCollection.waitFor({ state: "visible", timeout: 15_000 });
    await createCollection.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => undefined);
    await createCollection.click({ timeout: 15_000 });

    drawerOpened = await drawerReady
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (drawerOpened) {
      break;
    }

    log(
      options,
      `[meituan-drama] create collection drawer did not open, retrying: attempt=${attempt}/3`,
    );
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(300);
  }

  if (!drawerOpened) {
    throw new Error("MEITUAN_CREATE_COLLECTION_DRAWER_NOT_OPENED");
  }

  await fillCreateCollectionDrawer(page, taskConfig, options, copyrightProofFiles);
}

export async function selectPublishTargetStep(
  page: Page,
  taskConfig: MeituanCreationTaskConfig,
  options: MeituanCreationRuntimeOptions,
  copyrightProofFiles: string[],
) {
  await selectAuthor(page, taskConfig, options);
  await selectCollection(page, taskConfig, options, copyrightProofFiles);
}
