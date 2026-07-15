import type { Page } from "playwright";
import {
  PINDUODUO_CREATOR_MANAGEMENT_LIST_URL,
  PINDUODUO_MCN_ORIGIN,
} from "../shared/constants.js";
import { log } from "../shared/logger.js";
import type { ClaimedPinduoduoDramaTask, PinduoduoDramaRuntimeOptions } from "../shared/types.js";

const CREATOR_MANAGE_PATH = "/home/creator/manage";
const ACCOUNT_ROW_READY_TIMEOUT_MS = 30_000;
const CONTENT_MANAGEMENT_OPEN_TIMEOUT_MS = 15_000;
const CONTENT_MANAGEMENT_SETTLE_MS = 1_000;

export type PinduoduoContentManagementTarget = {
  pinduoduoAccountId?: string;
  pinduoduoAccountName?: string;
};

export type PinduoduoContentManagementPageResult = {
  accountId?: string;
  accountName?: string;
  openedInNewPage: boolean;
  page: Page;
  url: string;
};

export type PinduoduoApprovedShortplayFlowResult = {
  accountId?: string;
  accountName?: string;
  contentManagementUrl: string;
  status: "CONTENT_MANAGEMENT_READY";
};

function normalizeAccountId(value: string | number | undefined): string | undefined {
  const text = value === undefined ? "" : String(value).trim();
  return text || undefined;
}

function normalizeAccountName(value: string | undefined): string | undefined {
  const text = value?.trim() ?? "";
  return text || undefined;
}

function contentManagementUrlOpened(url: string): boolean {
  return url.startsWith(`${PINDUODUO_MCN_ORIGIN}${CREATOR_MANAGE_PATH}`);
}

async function waitForCreatorManagementRow(
  page: Page,
  target: PinduoduoContentManagementTarget,
): Promise<void> {
  const accountId = normalizeAccountId(target.pinduoduoAccountId);
  const accountName = normalizeAccountName(target.pinduoduoAccountName);
  if (!accountId && !accountName) {
    throw new Error("Pinduoduo content management requires account id or account name.");
  }

  await page.waitForFunction(
    ({ expectedAccountId, expectedAccountName }) => {
      return Array.from(
        document.querySelectorAll<HTMLTableRowElement>(
          'tr[data-testid="beast-core-table-body-tr"]',
        ),
      ).some((row) => {
        const cells = Array.from(
          row.querySelectorAll<HTMLElement>('td[data-testid="beast-core-table-td"]'),
        );
        const accountCellText = cells[0]?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const operationCellText =
          cells[cells.length - 1]?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        return (
          (!expectedAccountId || accountCellText.includes(expectedAccountId)) &&
          (!expectedAccountName || accountCellText.includes(expectedAccountName)) &&
          operationCellText.includes("内容管理")
        );
      });
    },
    { expectedAccountId: accountId, expectedAccountName: accountName },
    { timeout: ACCOUNT_ROW_READY_TIMEOUT_MS },
  );
}

async function clickContentManagementWithLocator(
  page: Page,
  target: PinduoduoContentManagementTarget,
): Promise<void> {
  const accountId = normalizeAccountId(target.pinduoduoAccountId);
  const accountName = normalizeAccountName(target.pinduoduoAccountName);
  let row = page.locator('tr[data-testid="beast-core-table-body-tr"]');

  if (accountId) {
    row = row.filter({ hasText: accountId });
  }
  if (accountName) {
    row = row.filter({ hasText: accountName });
  }

  const operationCell = row
    .first()
    .locator('td[data-testid="beast-core-table-td"]')
    .last();
  const contentManagement = operationCell.getByText(/^内容管理$/).last();

  await contentManagement.scrollIntoViewIfNeeded({ timeout: ACCOUNT_ROW_READY_TIMEOUT_MS });
  await contentManagement.click({
    force: true,
    timeout: ACCOUNT_ROW_READY_TIMEOUT_MS,
  });
}

async function clickContentManagementWithDom(
  page: Page,
  target: PinduoduoContentManagementTarget,
): Promise<void> {
  const clicked = await page.evaluate(({ expectedAccountId, expectedAccountName }) => {
    const rows = Array.from(
      document.querySelectorAll<HTMLTableRowElement>('tr[data-testid="beast-core-table-body-tr"]'),
    );
    const targetRow = rows.find((row) => {
      const cells = Array.from(
        row.querySelectorAll<HTMLElement>('td[data-testid="beast-core-table-td"]'),
      );
      const accountCellText = cells[0]?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      return (
        (!expectedAccountId || accountCellText.includes(expectedAccountId)) &&
        (!expectedAccountName || accountCellText.includes(expectedAccountName))
      );
    });
    if (!targetRow) {
      return false;
    }

    const cells = Array.from(
      targetRow.querySelectorAll<HTMLElement>('td[data-testid="beast-core-table-td"]'),
    );
    const operationCell = cells[cells.length - 1];
    const operationElements = operationCell
      ? Array.from(operationCell.querySelectorAll<HTMLElement>("*"))
      : [];
    const clickTarget = operationElements.find(
      (element: HTMLElement) => element.textContent?.trim() === "内容管理",
    );
    if (!clickTarget) {
      return false;
    }

    clickTarget.scrollIntoView({ block: "center", inline: "center" });
    clickTarget.click();
    return true;
  }, {
    expectedAccountId: normalizeAccountId(target.pinduoduoAccountId),
    expectedAccountName: normalizeAccountName(target.pinduoduoAccountName),
  });

  if (!clicked) {
    throw new Error("Pinduoduo content management action was not found in target row.");
  }
}

async function waitForContentManagementPage(
  page: Page,
  clickAction: () => Promise<void>,
): Promise<PinduoduoContentManagementPageResult["page"]> {
  const popupPromise = page
    .waitForEvent("popup", { timeout: CONTENT_MANAGEMENT_OPEN_TIMEOUT_MS })
    .catch(() => null);

  await clickAction();
  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState("domcontentloaded", {
      timeout: CONTENT_MANAGEMENT_OPEN_TIMEOUT_MS,
    });
    return popup;
  }

  await page.waitForURL((url) => contentManagementUrlOpened(url.href), {
    timeout: CONTENT_MANAGEMENT_OPEN_TIMEOUT_MS,
  });
  return page;
}

async function ensureContentManagementHeader(
  page: Page,
  target: PinduoduoContentManagementTarget,
): Promise<void> {
  const accountId = normalizeAccountId(target.pinduoduoAccountId);
  const accountName = normalizeAccountName(target.pinduoduoAccountName);

  await page.waitForFunction(
    ({ expectedAccountId, expectedAccountName }) => {
      const bodyText = document.body.textContent?.replace(/\s+/g, " ").trim() ?? "";
      return (
        (!expectedAccountId || bodyText.includes(`ID：${expectedAccountId}`)) &&
        (!expectedAccountName || bodyText.includes(`主播：${expectedAccountName}`))
      );
    },
    { expectedAccountId: accountId, expectedAccountName: accountName },
    { timeout: CONTENT_MANAGEMENT_OPEN_TIMEOUT_MS },
  );
}

export async function openPinduoduoContentManagementForAccount(
  page: Page,
  options: PinduoduoDramaRuntimeOptions,
  target: PinduoduoContentManagementTarget,
): Promise<PinduoduoContentManagementPageResult> {
  const accountId = normalizeAccountId(target.pinduoduoAccountId);
  const accountName = normalizeAccountName(target.pinduoduoAccountName);

  log(options, "info", "runtime", "opening pinduoduo creator management list", {
    accountId,
    accountName,
    url: PINDUODUO_CREATOR_MANAGEMENT_LIST_URL,
  });
  await page.goto(PINDUODUO_CREATOR_MANAGEMENT_LIST_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await waitForCreatorManagementRow(page, { pinduoduoAccountId: accountId, pinduoduoAccountName: accountName });

  const pagesBeforeClick = new Set(page.context().pages());
  const contentPage = await waitForContentManagementPage(page, async () => {
    try {
      await clickContentManagementWithLocator(page, {
        pinduoduoAccountId: accountId,
        pinduoduoAccountName: accountName,
      });
    } catch (error) {
      log(options, "warn", "runtime", "content management locator click failed, retrying in DOM", {
        accountId,
        accountName,
        error,
      });
      await clickContentManagementWithDom(page, {
        pinduoduoAccountId: accountId,
        pinduoduoAccountName: accountName,
      });
    }
  });

  await contentPage.waitForTimeout(CONTENT_MANAGEMENT_SETTLE_MS);
  await ensureContentManagementHeader(contentPage, {
    pinduoduoAccountId: accountId,
    pinduoduoAccountName: accountName,
  });

  const result = {
    accountId,
    accountName,
    openedInNewPage: !pagesBeforeClick.has(contentPage),
    page: contentPage,
    url: contentPage.url(),
  } satisfies PinduoduoContentManagementPageResult;

  log(options, "info", "runtime", "pinduoduo content management page opened", {
    accountId,
    accountName,
    openedInNewPage: result.openedInNewPage,
    url: result.url,
  });
  return result;
}

export async function runPinduoduoApprovedShortplayFlow(
  page: Page,
  options: PinduoduoDramaRuntimeOptions,
  task: ClaimedPinduoduoDramaTask,
): Promise<PinduoduoApprovedShortplayFlowResult> {
  log(options, "info", "runtime", "starting reserved pinduoduo approved shortplay flow", {
    accountTaskId: task.accountTaskId,
    dramaId: task.dramaId,
    pinduoduoAccountId: task.pinduoduoAccountId,
    pinduoduoAccountName: task.pinduoduoAccountName,
    title: task.playlet.title,
  });

  const contentManagement = await openPinduoduoContentManagementForAccount(page, options, {
    pinduoduoAccountId: task.pinduoduoAccountId,
    pinduoduoAccountName: task.pinduoduoAccountName,
  });

  log(
    options,
    "info",
    "runtime",
    "reserved pinduoduo approved shortplay flow reached content management page",
    {
      accountTaskId: task.accountTaskId,
      contentManagementUrl: contentManagement.url,
      title: task.playlet.title,
    },
  );

  return {
    accountId: contentManagement.accountId,
    accountName: contentManagement.accountName,
    contentManagementUrl: contentManagement.url,
    status: "CONTENT_MANAGEMENT_READY",
  };
}
