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
import {
  MEITUAN_CREATION_LOGIN_URL,
  MEITUAN_CREATION_PUBLISH_VIDEO_URL,
} from "../shared/constants.js";

type MeituanAppRootSnapshot = {
  exists: boolean;
  childElementCount: number;
  text: string;
  html: string;
};

type WaitForLoginResult = {
  recoveredBlankPage: boolean;
};

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
    appRoot: await readMeituanAppRoot(page),
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

async function readMeituanAppRoot(page: Page): Promise<MeituanAppRootSnapshot> {
  return page.evaluate(() => {
    const root = document.querySelector("#app");
    return {
      exists: Boolean(root),
      childElementCount: root?.childElementCount ?? 0,
      text: (root?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 500),
      html: (root?.innerHTML ?? "").trim().slice(0, 1_000),
    };
  }).catch(() => ({
    exists: false,
    childElementCount: 0,
    text: "",
    html: "",
  }));
}

export function isBlankMeituanAppRoot(snapshot: MeituanAppRootSnapshot) {
  return snapshot.exists && snapshot.childElementCount === 0 && snapshot.text.length === 0;
}

async function isPersistentlyBlankMeituanPage(page: Page) {
  for (let sample = 0; sample < 3; sample += 1) {
    if (!isBlankMeituanAppRoot(await readMeituanAppRoot(page))) return false;
    if (sample < 2) await page.waitForTimeout(1_000);
  }
  return true;
}

async function openLoginPageForExpiredSession(
  page: Page,
  options: MeituanCreationRuntimeOptions,
) {
  log(options, "[meituan-drama] 检测到发布页为空，登录已失效，正在打开登录页");
  const cleanupResults = await Promise.allSettled([
    page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    }),
    page.context().clearCookies(),
  ]);
  if (cleanupResults.some((result) => result.status === "rejected")) {
    log(options, "[meituan-drama] 失效登录态未完全清理，继续打开登录页");
  }
  await page.goto(MEITUAN_CREATION_LOGIN_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  }).catch((error: unknown) => {
    throw Object.assign(
      new Error(
        `MEITUAN_LOGIN_PAGE_OPEN_FAILED: ${error instanceof Error ? error.message : String(error)}`,
      ),
      { cause: error },
    );
  });
  log(options, "[meituan-drama] 登录页已打开，请重新登录");
}

export async function waitForLogin(
  page: Page,
  options: MeituanCreationRuntimeOptions,
  allowBlankPageRecovery = true,
): Promise<WaitForLoginResult> {
  let recoveredBlankPage = false;
  if (await isPublishFormReady(page)) {
    log(options, "[meituan-drama] already logged in");
    return { recoveredBlankPage };
  }

  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  if (await isPublishFormReady(page)) {
    log(options, "[meituan-drama] already logged in");
    return { recoveredBlankPage };
  }

  if (
    page.url().includes("/new/publishVideo")
    && await isPersistentlyBlankMeituanPage(page)
  ) {
    if (!allowBlankPageRecovery) {
      throw new Error(
        "MEITUAN_LOGIN_REQUIRED: 重新登录后发布页仍为空白，请确认登录完成后重试",
      );
    }
    await openLoginPageForExpiredSession(page, options);
    recoveredBlankPage = true;
  }

  if (!page.url().includes("/new/login")) {
    return { recoveredBlankPage };
  }

  log(options, "[meituan-drama] 等待重新登录");
  await page.waitForFunction(
    () => {
      const bodyText = document.body?.innerText ?? "";
      return !location.href.includes("/new/login") || bodyText.includes("发布至合集");
    },
    undefined,
    { timeout: 0 },
  );
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  log(options, "[meituan-drama] 登录完成");
  return { recoveredBlankPage };
}

export async function waitForPublishPageReady(
  page: Page,
  options: MeituanCreationRuntimeOptions,
) {
  const navigateToPublishPage = () => page.goto(MEITUAN_CREATION_PUBLISH_VIDEO_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  let blankPageRecoveryUsed = false;
  await navigateToPublishPage();

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const loginResult = await waitForLogin(page, options, !blankPageRecoveryUsed);
    blankPageRecoveryUsed ||= loginResult.recoveredBlankPage;
    if (await isPublishFormReady(page)) return;

    if (!page.url().includes("/new/publishVideo")) {
      await navigateToPublishPage();
      continue;
    }

    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    if (await isPublishFormReady(page)) return;
    if (await isPersistentlyBlankMeituanPage(page)) {
      if (blankPageRecoveryUsed) {
        throw new Error(
          "MEITUAN_LOGIN_REQUIRED: 重新登录后发布页仍为空白，请确认登录完成后重试",
        );
      }
      continue;
    }
    await page.getByText("发布至合集").waitFor({ state: "visible", timeout: 60_000 });
    return;
  }

  throw new Error("MEITUAN_LOGIN_REQUIRED: 登录完成后未能进入美团发布页，请重新登录");
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
