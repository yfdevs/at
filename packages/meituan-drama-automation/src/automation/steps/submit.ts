import type { Page } from "playwright";
import type { MeituanCreationRuntimeOptions } from "../../shared/types.js";
import { log } from "../browser-session.js";
import { scrollLocatorIntoView } from "../form-controls.js";

const submitButtonTextPattern = /提交[\s\S]*(?:审核|送审)/;
const fieldValidationSelector = ".mtd-form-item-error-tip:visible, .err-tips:visible";
const submitErrorMessageSelectors = [
  ".mtd-message.mtd-message-error .mtd-message-content",
  ".mtd-message-error .mtd-message-content",
  ".mtd-message.mtd-message-error[role='alert']",
  ".mtd-message-error[role='alert']",
];
const submitSettleDelayMs = 10_000;

function submitErrorCaptureScript() {
  const selectorsJson = JSON.stringify(submitErrorMessageSelectors);
  return `(() => {
    const selectors = ${selectorsJson};
    const state = window;
    state.__meituanDramaCapturedSubmitErrors ??= [];
    if (state.__meituanDramaSubmitErrorCaptureInstalled) return;

    const selector = selectors.join(",");
    const captureElement = (element) => {
      if (!(element instanceof HTMLElement) || !element.matches(selector)) return;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) {
        return;
      }
      const message = element.textContent?.replace(/\\s+/g, " ").trim();
      if (message && !state.__meituanDramaCapturedSubmitErrors.includes(message)) {
        state.__meituanDramaCapturedSubmitErrors.push(message);
      }
    };
    const captureNode = (node) => {
      if (node instanceof Element) {
        captureElement(node);
        node.querySelectorAll(selector).forEach(captureElement);
      } else if (node.parentElement) {
        captureElement(node.parentElement);
      }
    };

    const install = () => {
      if (state.__meituanDramaSubmitErrorCaptureInstalled || !document.body) return;
      state.__meituanDramaSubmitErrorCaptureInstalled = true;
      document.querySelectorAll(selector).forEach(captureElement);
      state.__meituanDramaSubmitErrorObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          captureNode(mutation.target);
          mutation.addedNodes.forEach(captureNode);
        });
      });
      state.__meituanDramaSubmitErrorObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ["class", "style"],
        characterData: true,
        childList: true,
        subtree: true,
      });
    };
    if (document.body) install();
    else document.addEventListener("DOMContentLoaded", install, { once: true });
  })()`;
}

export async function installMeituanSubmitErrorCapture(page: Page) {
  const script = submitErrorCaptureScript();
  await page.addInitScript({ content: script });
  await page.evaluate(script);
}

async function capturedSubmitErrorTexts(page: Page) {
  return page.evaluate(() => {
    const state = window as typeof window & {
      __meituanDramaCapturedSubmitErrors?: string[];
    };
    const messages = [...(state.__meituanDramaCapturedSubmitErrors ?? [])];
    state.__meituanDramaCapturedSubmitErrors = [];
    return messages;
  }).catch(() => [] as string[]);
}

async function visibleFieldValidationTexts(page: Page) {
  return [
    ...new Set(
      (await page.locator(fieldValidationSelector).allInnerTexts().catch(() => []))
        .map((text) => text.replace(/\s+/g, " ").trim())
        .filter(Boolean),
    ),
  ];
}

async function throwIfFieldValidationFailed(page: Page) {
  const texts = await visibleFieldValidationTexts(page);
  if (texts.length > 0) {
    throw new Error(`MEITUAN_SUBMIT_FORM_INVALID: ${texts.join("；")}`);
  }
}

async function throwIfSubmitErrorAppeared(page: Page) {
  const visibleMessages = await page
    .locator(submitErrorMessageSelectors.map((selector) => `${selector}:visible`).join(", "))
    .allInnerTexts()
    .catch(() => [] as string[]);
  const texts = [
    ...await capturedSubmitErrorTexts(page),
    ...visibleMessages,
  ]
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (texts.length > 0) {
    throw new Error(`MEITUAN_SUBMIT_FAILED: ${[...new Set(texts)].join("；")}`);
  }
  await throwIfFieldValidationFailed(page);
}

export async function waitForMeituanSubmitSettle(
  page: Page,
  options: { settleMs?: number; pollIntervalMs?: number } = {},
) {
  const settleMs = options.settleMs ?? submitSettleDelayMs;
  const pollIntervalMs = options.pollIntervalMs ?? 200;
  const deadline = Date.now() + settleMs;
  while (Date.now() < deadline) {
    await throwIfSubmitErrorAppeared(page);
    await page.waitForTimeout(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
  }
  await throwIfSubmitErrorAppeared(page);
}

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
  const validationTips = page.locator(fieldValidationSelector);
  const submitResult = await Promise.race([
    confirmModal
      .waitFor({ state: "visible", timeout: 60_000 })
      .then(() => "confirm" as const),
    validationTips
      .first()
      .waitFor({ state: "visible", timeout: 60_000 })
      .then(() => "validation" as const),
  ]);
  if (submitResult === "validation") {
    await throwIfFieldValidationFailed(page);
  }

  const confirmButton = confirmModal.getByRole("button", {
    name: "确认提交",
    exact: true,
  });
  await confirmButton.waitFor({ state: "visible", timeout: 30_000 });
  await installMeituanSubmitErrorCapture(page);
  await throwIfSubmitErrorAppeared(page);
  await confirmButton.click({ timeout: 30_000 });
  await waitForMeituanSubmitSettle(page);

  log(options, "[meituan-drama] submit confirmation button clicked");
}
