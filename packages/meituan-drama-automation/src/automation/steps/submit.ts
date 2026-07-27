import type { Page } from "playwright";
import type { MeituanCreationRuntimeOptions } from "../../shared/types.js";
import { log } from "../browser-session.js";
import { scrollLocatorIntoView } from "../form-controls.js";

const submitButtonTextPattern = /提交[\s\S]*(?:审核|送审)/;

export async function submitPublishStep(
  page: Page,
  options: MeituanCreationRuntimeOptions,
): Promise<void> {
  log(options, "[meituan-drama] submitting publish form");

  const publishButton = page
    .getByRole("button", { name: submitButtonTextPattern })
    .or(page.locator("button.submit-btn").filter({ hasText: submitButtonTextPattern }))
    .or(page.locator("button").filter({ hasText: submitButtonTextPattern }))
    .filter({ visible: true })
    .first();

  await publishButton.waitFor({ state: "visible", timeout: 60_000 }).catch(async (error) => {
    const visibleButtonTexts = (await page.locator("button:visible").allInnerTexts())
      .map((text) => text.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    throw Object.assign(
      new Error(
        `MEITUAN_SUBMIT_BUTTON_NOT_FOUND: visibleButtons=` +
          `${visibleButtonTexts.length > 0 ? visibleButtonTexts.join(" | ") : "(none)"}`,
      ),
      { cause: error },
    );
  });
  await scrollLocatorIntoView(page, publishButton);
  await publishButton.click({ timeout: 30_000 });

  log(options, "[meituan-drama] submit and review button clicked");

  const confirmModal = page
    .locator(".mtd-modal:visible")
    .filter({ hasText: "提交后将进入审核流程" })
    .last();
  await confirmModal.waitFor({ state: "visible", timeout: 60_000 });

  const confirmButton = confirmModal.getByRole("button", {
    name: "确认提交",
    exact: true,
  });
  await confirmButton.waitFor({ state: "visible", timeout: 30_000 });
  await confirmButton.click({ timeout: 30_000 });
  await page.waitForTimeout(1_000);

  log(options, "[meituan-drama] submit confirmation button clicked");
}
