import type { Page } from "playwright";
import type { MeituanCreationRuntimeOptions } from "../../shared/types.js";
import { log } from "../browser-session.js";
import { exactTextPattern, scrollLocatorIntoView } from "../form-controls.js";

export async function submitPublishStep(
  page: Page,
  options: MeituanCreationRuntimeOptions,
): Promise<void> {
  log(options, "[meituan-drama] submitting publish form");

  const publishButton = page
    .locator("button.submit-btn")
    .filter({ hasText: exactTextPattern("发布") })
    .first();

  await publishButton.waitFor({ state: "visible", timeout: 60_000 });
  await scrollLocatorIntoView(page, publishButton);
  await publishButton.click({ timeout: 30_000 });
  await page.waitForTimeout(1_000);

  log(options, "[meituan-drama] publish button clicked");
}
