import type { Page } from "playwright";
import type { KuaishouDramaRuntimeOptions } from "../shared/types.js";
import { log } from "./browser-session.js";
import { scrollLocatorIntoView } from "./form-controls.js";
import { throwIfKuaishouWarningCaptured } from "./warning-guard.js";

const videoUploadStepTimeoutMs = 120_000;
const resultPollIntervalMs = 150;

function isVideoUploadStepUrl(urlText: string) {
  try {
    const url = new URL(urlText);
    return (
      url.origin === "https://kdj.kuaishou.com" &&
      url.pathname === "/home/content/content-management/edit" &&
      url.searchParams.get("step") === "1"
    );
  } catch {
    return false;
  }
}

async function throwIfEpisodeFormInvalid(page: Page) {
  const dialog = page
    .locator('.ks-message-box[aria-label="提示"]:visible')
    .filter({ hasText: /信息填写错误/ })
    .last();
  if (!await dialog.isVisible().catch(() => false)) return;

  const message = (await dialog.locator(".ks-message-box__message").innerText())
    .replace(/\s+/g, " ")
    .trim();
  const acknowledge = dialog
    .locator("button.ks-button--primary")
    .filter({ hasText: /^\s*确\s*定\s*$/ })
    .last();
  await acknowledge.evaluate((button) => (button as HTMLElement).click()).catch(() => undefined);
  await dialog.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);
  throw new Error(`KUAISHOU_DRAMA_EPISODE_FORM_INVALID: ${message}`);
}

async function throwIfVisibleValidationFailed(page: Page) {
  const validationMessages = await page
    .locator(".ks-form-item__error:visible,.ks-message--error:visible,.err-tips:visible")
    .allInnerTexts()
    .catch(() => []);
  const normalizedMessages = Array.from(new Set(
    validationMessages.map((text) => text.replace(/\s+/g, " ").trim()).filter(Boolean),
  ));
  if (normalizedMessages.length) {
    throw new Error(
      `KUAISHOU_DRAMA_NEXT_STEP_VALIDATION_FAILED: ${normalizedMessages.join(" | ")}`,
    );
  }
}

export async function enterKuaishouDramaVideoUploadStep(
  page: Page,
  options: KuaishouDramaRuntimeOptions,
) {
  const nextButton = page
    .locator("button.ks-button--primary:visible")
    .filter({ hasText: /^\s*下一步\s*$/ })
    .last();
  await nextButton.waitFor({ state: "visible", timeout: 30_000 });
  await scrollLocatorIntoView(page, nextButton);
  await nextButton.click({ timeout: 30_000 });
  log(options, "[kuaishou-drama] next step clicked; waiting for submission confirmation");

  const deadline = Date.now() + videoUploadStepTimeoutMs;
  let confirmationClicked = false;
  while (Date.now() < deadline) {
    if (isVideoUploadStepUrl(page.url())) {
      log(options, `[kuaishou-drama] video upload step entered: ${page.url()}`);
      return;
    }

    await throwIfKuaishouWarningCaptured(page, options);
    await throwIfEpisodeFormInvalid(page);

    if (!confirmationClicked) {
      const confirmationDialog = page
        .locator('.ks-message-box[aria-label="确认提示"]:visible')
        .last();
      if (await confirmationDialog.isVisible().catch(() => false)) {
        const confirm = confirmationDialog
          .locator("button.ks-button--primary")
          .filter({ hasText: /^\s*(?:确\s*认|确\s*定)\s*$/ })
          .last();
        await confirm.waitFor({ state: "visible", timeout: 10_000 });
        await confirm.evaluate((button) => (button as HTMLElement).click());
        confirmationClicked = true;
        log(
          options,
          "[kuaishou-drama] submission confirmation clicked; waiting for URL step=1",
        );
      } else {
        await throwIfVisibleValidationFailed(page);
      }
    }

    await page.waitForTimeout(resultPollIntervalMs);
  }

  throw new Error(
    `KUAISHOU_DRAMA_VIDEO_UPLOAD_STEP_TIMEOUT: ` +
      `confirmationClicked=${confirmationClicked}; url=${page.url()}`,
  );
}

