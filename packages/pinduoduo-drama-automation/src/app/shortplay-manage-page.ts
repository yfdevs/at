import type { BrowserContext, Page } from "playwright";
import {
  PINDUODUO_LOGIN_EXPIRED_URL,
  PINDUODUO_MCN_ORIGIN,
  PINDUODUO_SHORTPLAY_MANAGE_URL,
} from "../shared/constants.js";
import { log } from "../shared/logger.js";
import type { PinduoduoDramaLoginState, PinduoduoDramaRuntimeOptions } from "../shared/types.js";
import { pinduoduoDramaLoginStateFromUrl, saveCredentialState } from "./browser-session.js";

const LOGIN_REDIRECT_WAIT_MS = 10_000;
const LOGIN_API_WAIT_MS = 12_000;
const SHORTPLAY_TAB_SWITCH_TIMEOUT_MS = 10_000;
const SHORTPLAY_TAB_ACTIVE_TIMEOUT_MS = 3_000;
const SHORTPLAY_TAB_REFRESH_SETTLE_MS = 1_200;
const PINDUODUO_USER_INFO_URL = `${PINDUODUO_MCN_ORIGIN}/api/cafe/login/user_info`;

function isPinduoduoLoginRequiredPayload(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const errorCode = "error_code" in payload ? payload.error_code : undefined;
  return errorCode === 40001 || errorCode === "40001";
}

async function waitForPinduoduoUserInfoLoginState(page: Page): Promise<PinduoduoDramaLoginState> {
  const response = await page
    .waitForResponse((nextResponse) => nextResponse.url().startsWith(PINDUODUO_USER_INFO_URL), {
      timeout: LOGIN_API_WAIT_MS,
    })
    .catch(() => undefined);

  if (!response) {
    return "unknown";
  }

  const payload = await response.json().catch(() => undefined);
  if (!response.ok() || isPinduoduoLoginRequiredPayload(payload)) {
    return "login-required";
  }

  return "logged-in";
}

async function waitForLoginStateAfterNavigation(page: Page): Promise<PinduoduoDramaLoginState> {
  let loginState = pinduoduoDramaLoginStateFromUrl(page.url());
  if (loginState === "login-required") {
    return loginState;
  }

  const apiLoginState = await waitForPinduoduoUserInfoLoginState(page);
  if (apiLoginState !== "unknown") {
    return apiLoginState;
  }

  await page
    .waitForURL((url) => pinduoduoDramaLoginStateFromUrl(url.href) === "login-required", {
      timeout: LOGIN_REDIRECT_WAIT_MS,
    })
    .catch(() => undefined);

  loginState = pinduoduoDramaLoginStateFromUrl(page.url());
  return loginState === "login-required" ? "login-required" : "unknown";
}

async function waitForManualLoginAndOpenShortplayManagePage(
  page: Page,
  context: BrowserContext,
  options: PinduoduoDramaRuntimeOptions,
): Promise<void> {
  log(options, "warn", "runtime", "waiting for manual login before claiming tasks", {
    activeUrl: page.url(),
    loginExpiredUrl: PINDUODUO_LOGIN_EXPIRED_URL,
  });

  await page
    .goto(PINDUODUO_LOGIN_EXPIRED_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    })
    .catch(() => undefined);

  while (!page.isClosed()) {
    await page.waitForURL((url) => pinduoduoDramaLoginStateFromUrl(url.href) === "logged-in", {
      timeout: 0,
    });

    log(options, "info", "runtime", "manual login detected, reopening shortplay manage page", {
      activeUrl: page.url(),
      manageUrl: PINDUODUO_SHORTPLAY_MANAGE_URL,
    });

    await page.goto(PINDUODUO_SHORTPLAY_MANAGE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    const loginState = await waitForLoginStateAfterNavigation(page);
    if (loginState === "logged-in") {
      log(options, "info", "runtime", "manual login completed, shortplay manage page reopened", {
        activeUrl: page.url(),
        loginState,
      });
      await saveCredentialState(context, options).catch(() => undefined);
      return;
    }

    log(
      options,
      "warn",
      "runtime",
      "login is still required after reopening shortplay manage page",
      {
        activeUrl: page.url(),
        loginState,
      },
    );
  }

  throw new Error("Pinduoduo browser page was closed while waiting for manual login.");
}

export async function openShortplayManagePage(
  page: Page,
  context: BrowserContext,
  options: PinduoduoDramaRuntimeOptions,
): Promise<void> {
  log(options, "info", "runtime", "opening shortplay manage page", {
    url: PINDUODUO_SHORTPLAY_MANAGE_URL,
  });
  await page.goto(PINDUODUO_SHORTPLAY_MANAGE_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  const loginState = await waitForLoginStateAfterNavigation(page);
  if (loginState !== "logged-in") {
    log(options, "warn", "runtime", "login is required before opening shortplay manage page", {
      activeUrl: page.url(),
      loginExpiredUrl: PINDUODUO_LOGIN_EXPIRED_URL,
      loginState,
    });
    await waitForManualLoginAndOpenShortplayManagePage(page, context, options);
    return;
  }

  log(options, "info", "runtime", "shortplay manage page opened", {
    activeUrl: page.url(),
    loginState,
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function dispatchShortplayManageTabClick(page: Page, label: string): Promise<boolean> {
  return page.evaluate((expectedLabel) => {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="beast-core-tab-itemLabel"]'),
    );
    const target = candidates.find((element) => element.textContent?.trim() === expectedLabel);
    if (!target) {
      return false;
    }

    target.scrollIntoView({ block: "center", inline: "center" });
    for (const eventType of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      target.dispatchEvent(
        new MouseEvent(eventType, {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
    }
    target.click();
    return true;
  }, label);
}

async function waitForShortplayManageTabActive(page: Page, label: string): Promise<void> {
  await page.waitForFunction(
    (expectedLabel) => {
      function hasActiveMarker(element: Element): boolean {
        let current: Element | null = element;
        let depth = 0;
        while (current && depth < 5) {
          if (
            current.getAttribute("aria-selected") === "true" ||
            Array.from(current.classList).some((className) => className.includes("TAB_active"))
          ) {
            return true;
          }
          current = current.parentElement;
          depth += 1;
        }
        return false;
      }

      return Array.from(document.querySelectorAll('[data-testid="beast-core-tab-itemLabel"]')).some(
        (element) => element.textContent?.trim() === expectedLabel && hasActiveMarker(element),
      );
    },
    label,
    { timeout: SHORTPLAY_TAB_ACTIVE_TIMEOUT_MS },
  );
}

async function clickShortplayManageTab(
  page: Page,
  options: PinduoduoDramaRuntimeOptions,
  label: string,
): Promise<void> {
  const tab = page
    .locator('[data-testid="beast-core-tab-itemLabel"]')
    .filter({ hasText: new RegExp(`^\\s*${escapeRegex(label)}\\s*$`) })
    .first();

  await tab.waitFor({
    state: "visible",
    timeout: SHORTPLAY_TAB_SWITCH_TIMEOUT_MS,
  });

  const clickStartedAt = Date.now();
  let clickedByPlaywright = false;
  await tab.scrollIntoViewIfNeeded({ timeout: SHORTPLAY_TAB_SWITCH_TIMEOUT_MS });
  await tab
    .click({ force: true, timeout: SHORTPLAY_TAB_SWITCH_TIMEOUT_MS })
    .then(() => {
      clickedByPlaywright = true;
    })
    .catch((error: unknown) => {
      log(options, "warn", "runtime", "shortplay manage tab Playwright click failed", {
        label,
        error,
      });
    });

  const clickedInPage = await dispatchShortplayManageTabClick(page, label);
  if (!clickedByPlaywright && !clickedInPage) {
    throw new Error(`Pinduoduo shortplay manage tab not found: ${label}`);
  }
  if (clickedInPage) {
    log(options, "info", "runtime", "shortplay manage tab DOM click dispatched", {
      label,
      clickedByPlaywright,
    });
  }

  await waitForShortplayManageTabActive(page, label).catch((error: unknown) => {
    log(options, "warn", "runtime", "shortplay manage tab active state was not detected", {
      label,
      error,
    });
  });
  log(options, "info", "runtime", "shortplay manage tab clicked", {
    label,
    elapsedMs: Date.now() - clickStartedAt,
  });
}

export async function refreshShortplayManagePendingList(
  page: Page,
  options: PinduoduoDramaRuntimeOptions,
): Promise<void> {
  log(options, "info", "runtime", "refreshing shortplay manage pending list by switching tabs");

  await clickShortplayManageTab(page, options, "已提报短剧");
  await page.waitForTimeout(SHORTPLAY_TAB_REFRESH_SETTLE_MS);
  await clickShortplayManageTab(page, options, "待提报短剧");
  await page.waitForTimeout(SHORTPLAY_TAB_REFRESH_SETTLE_MS);

  log(options, "info", "runtime", "shortplay manage pending list refreshed");
}
