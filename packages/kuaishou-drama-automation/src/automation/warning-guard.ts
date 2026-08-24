import type { Page } from "playwright";
import type { KuaishouDramaRuntimeOptions } from "../shared/types.js";
import { log } from "./browser-session.js";

const pagesWithWarningGuard = new WeakSet<Page>();
const capturedWarningMessages = new WeakMap<Page, Set<string>>();

function normalizeMessages(messages: string[]) {
  return Array.from(new Set(
    messages.map((text) => text.replace(/\s+/g, " ").trim()).filter(Boolean),
  ));
}

function recordWarnings(
  page: Page,
  messages: string[],
  options: KuaishouDramaRuntimeOptions,
) {
  const stored = capturedWarningMessages.get(page) ?? new Set<string>();
  capturedWarningMessages.set(page, stored);
  for (const message of normalizeMessages(messages)) {
    if (stored.has(message)) continue;
    stored.add(message);
    log(options, `[kuaishou-drama] fatal warning captured: ${message}`);
  }
}

export async function installWarningMessageGuard(
  page: Page,
  options: KuaishouDramaRuntimeOptions,
) {
  if (pagesWithWarningGuard.has(page)) return;
  pagesWithWarningGuard.add(page);
  capturedWarningMessages.set(page, new Set());

  const warningMessages = page.locator(
    '.ks-message.ks-message--warning[role="alert"]:visible',
  );
  await page.addLocatorHandler(
    warningMessages,
    async (matchedWarnings) => {
      const contents = await matchedWarnings
        .locator(".ks-message__content")
        .allInnerTexts()
        .catch(() => []);
      recordWarnings(page, contents, options);
    },
    { noWaitAfter: true },
  );
}

export async function throwIfKuaishouWarningCaptured(
  page: Page,
  options: KuaishouDramaRuntimeOptions,
) {
  const visibleContents = await page
    .locator('.ks-message.ks-message--warning[role="alert"]:visible .ks-message__content')
    .allInnerTexts()
    .catch(() => []);
  recordWarnings(page, visibleContents, options);

  const messages = Array.from(capturedWarningMessages.get(page) ?? []);
  if (messages.length) {
    throw new Error(`KUAISHOU_DRAMA_WARNING_MESSAGE: ${messages.join(" | ")}`);
  }
}
