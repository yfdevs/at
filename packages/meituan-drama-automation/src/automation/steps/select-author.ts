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
  await clickWhenReady(page, page.getByText(taskConfig.authorNicknameText));
}

async function selectCollection(
  page: Page,
  taskConfig: MeituanCreationTaskConfig,
  options: MeituanCreationRuntimeOptions,
) {
  log(options, "[meituan-drama] selecting collection");

  const collectionTextbox = page.getByRole("textbox", { name: "选择或创建合集" });
  await collectionTextbox.waitFor({ state: "visible", timeout: 60_000 });
  await collectionTextbox.click({ timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);

  const createCollection = page
    .locator("div")
    .filter({ hasText: /^创建新合集$/ })
    .nth(2);
  await createCollection.waitFor({ state: "visible", timeout: 60_000 });
  await createCollection.click({ timeout: 30_000 });
  await fillCreateCollectionDrawer(page, taskConfig, options);
}

export async function selectPublishTargetStep(
  page: Page,
  taskConfig: MeituanCreationTaskConfig,
  options: MeituanCreationRuntimeOptions,
) {
  await selectAuthor(page, taskConfig, options);
  await selectCollection(page, taskConfig, options);
}
