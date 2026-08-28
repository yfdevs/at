import type { Page } from "playwright";
import { createLogger } from "../../shared/logger.js";

const submitLogger = createLogger("submit");

function normalizeUiText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

async function collectVisibleSubmitErrors(page: Page): Promise<string[]> {
  const texts: string[] = [];
  const errors = page.locator(".submit-error");
  const count = await errors.count();
  for (let index = 0; index < count; index += 1) {
    const error = errors.nth(index);
    if (!await error.isVisible().catch(() => false)) continue;
    const text = normalizeUiText(
      await error.innerText().catch(() => "") || await error.textContent().catch(() => ""),
    );
    if (text) texts.push(text);
  }
  return Array.from(new Set(texts));
}

async function clickFinalConfirmReviewButton(page: Page): Promise<void> {
  const app = page.locator("wujie-app:visible").first();
  const button = app.locator(
    "button.weui-desktop-btn_primary",
    { hasText: /^确认提审$/ },
  ).first();
  await button.waitFor({ state: "visible", timeout: 30000 });
  await button.scrollIntoViewIfNeeded();
  await button.click({ timeout: 30000 });
  submitLogger.info("已点击确认提审");
}

export async function confirmAndMaybeSubmitStep(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);

  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await clickFinalConfirmReviewButton(page);
    submitLogger.info("正在检查提交结果");
    await page.waitForTimeout(3000);

    const errors = await collectVisibleSubmitErrors(page);
    if (errors.length === 0) break;

    const errorText = errors.join("；");
    if (attempt === maxAttempts) {
      throw new Error(`[final-submit-validation-failed] 重试 ${maxAttempts} 次后仍提示：${errorText}`);
    }

    submitLogger.warn("提交失败，准备重试", {
      errorMessage: errorText,
      attempt: attempt + 1,
      total: maxAttempts,
    });
  }

  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => undefined);
}
