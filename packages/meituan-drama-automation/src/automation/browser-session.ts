import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  cleanupAutomationLogFiles,
  createAutomationLogger,
  formatReadableLogEntry,
} from "@drama/automation-logging";
import type { BrowserContext, Page } from "playwright";
import type {
  MeituanCreationLoginState,
  MeituanCreationRuntimeOptions,
} from "../shared/types.js";

export function log(options: MeituanCreationRuntimeOptions, message: string) {
  runtimeLogger(options).callback()(message);
}

function diagnosticPathSegment(value: string | number) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}

export async function saveTaskFailureDiagnostics(options: {
  page: Page | null;
  runtimeOptions: MeituanCreationRuntimeOptions;
  taskId: string | number;
  error: unknown;
}) {
  const { page, runtimeOptions, taskId, error } = options;
  if (!page || page.isClosed() || !runtimeOptions.logFilePath) return null;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const diagnosticDir = join(
    dirname(runtimeOptions.logFilePath),
    "diagnostics",
    `${diagnosticPathSegment(taskId)}-${timestamp}`,
  );
  await mkdir(diagnosticDir, { recursive: true });

  const visibleText = async (selector: string) => (
    await page.locator(selector).allInnerTexts().catch(() => [])
  )
    .map((text) => text.replace(/\s+/g, " ").trim().slice(0, 500))
    .filter(Boolean);
  const details = {
    time: new Date().toISOString(),
    taskId,
    url: page.url(),
    title: await page.title().catch(() => ""),
    error: error instanceof Error ? error.message : String(error),
    visibleDrawers: await visibleText(
      ".mtd-drawer:visible, .mtd-drawer-wrapper:visible, .mtd-drawer-container:visible",
    ),
    visibleModals: await visibleText(".mtd-modal:visible"),
    visibleMessages: await visibleText(".mtd-message:visible"),
    visibleFormErrors: await visibleText(".mtd-form-item-error-tip:visible, .err-tips:visible"),
    visibleButtons: await visibleText("button:visible"),
    draggerCount: await page.locator(".mtd-upload-dragger").count().catch(() => -1),
    visibleDraggerCount: await page.locator(".mtd-upload-dragger:visible").count().catch(() => -1),
    fileInputs: await page
      .locator('input[type="file"]')
      .evaluateAll((elements: HTMLInputElement[]) => elements.map((element) => ({
        accept: element.accept,
        className: element.className,
        disabled: element.disabled,
        multiple: element.multiple,
      })))
      .catch(() => []),
  };

  await Promise.all([
    writeFile(join(diagnosticDir, "details.json"), JSON.stringify(details, null, 2), "utf8"),
    page.content().then((html) => writeFile(join(diagnosticDir, "page.html"), html, "utf8")),
    page.screenshot({ path: join(diagnosticDir, "page.png"), fullPage: true }),
  ].map((operation) => operation.catch(() => undefined)));
  return diagnosticDir;
}

function runtimeLogger(options: MeituanCreationRuntimeOptions) {
  return createAutomationLogger({
    platform: "meituan-drama",
    scope: "runtime",
    context: {
      accountId: options.meituanAccountId,
      accountName: options.meituanAccountName,
    },
    logFilePath: options.logFilePath,
    retentionDays: options.logRetentionDays,
    onEntry: options.onLog
      ? (entry) => options.onLog?.(formatReadableLogEntry(entry))
      : undefined,
  });
}

export async function cleanupOldLogFiles(options: MeituanCreationRuntimeOptions) {
  if (!options.logFilePath) return;
  await cleanupAutomationLogFiles(options.logFilePath, options.logRetentionDays ?? 3);
}

export function loginStateFromUrl(url: string): MeituanCreationLoginState {
  if (!url) return "unknown";
  return url.includes("/new/login") ? "login-required" : "logged-in";
}

async function isPublishFormReady(page: Page) {
  return page
    .getByText("发布至合集")
    .isVisible({ timeout: 1500 })
    .catch(() => false);
}

export async function waitForLogin(page: Page, options: MeituanCreationRuntimeOptions) {
  if (await isPublishFormReady(page)) {
    log(options, "[meituan-drama] already logged in");
    return;
  }

  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  if (await isPublishFormReady(page)) {
    log(options, "[meituan-drama] already logged in");
    return;
  }

  if (!page.url().includes("/new/login")) {
    return;
  }

  log(options, "[meituan-drama] waiting for login");
  await page.waitForFunction(
    () => {
      const bodyText = document.body?.innerText ?? "";
      return !location.href.includes("/new/login") || bodyText.includes("发布至合集");
    },
    undefined,
    { timeout: 0 },
  );
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  log(options, "[meituan-drama] login completed");
}

export async function saveCredentialState(
  context: BrowserContext,
  options: MeituanCreationRuntimeOptions,
) {
  if (!options.credentialStatePath) {
    return;
  }

  await mkdir(dirname(options.credentialStatePath), { recursive: true });
  await context.storageState({ path: options.credentialStatePath });
  log(options, `[meituan-drama] credential state saved: ${options.credentialStatePath}`);
}
