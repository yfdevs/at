import { spawn } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import {
  ensureBaiduCdpPort,
  getTargets,
  waitForDocumentBody,
  waitForTarget,
  withPage,
} from "../infrastructure/cdp.js";
import {
  DEFAULT_BAIDU_NETDISK_DOWNLOAD_DIR,
  DEFAULT_BAIDU_NETDISK_SHARE_NAME,
  DOWNLOAD_SETTING_MAX_ATTEMPTS,
  OWN_NETDISK_DIR_LIST_MAX_PAGES,
  OWN_NETDISK_DIR_LIST_PAGE_SIZE,
  REMOTE_DIR_ENTRY_SAMPLE_LIMIT,
  REMOTE_VIDEO_SCAN_MAX_DEPTH,
  REMOTE_VIDEO_SCAN_MAX_DIRS,
  SHARE_LIST_MAX_PAGES,
} from "../domain/constants.js";
import { log, logRemoteVideoScanDetails, warn } from "../infrastructure/logging.js";
import {
  RemoteMaterialValidationError,
  classifyBaiduNetdiskAutomationError,
  errorMessage,
  type BaiduNetdiskAutomationError,
} from "../domain/errors.js";
import {
  retryWithDelays,
  runPromisePreservingFailure,
} from "../runtime/effect-runtime.js";
import { parseBaiduNetdiskShareText, readShareInfo, sanitizeWindowsName } from "../domain/share-text.js";
import type {
  BaiduNetdiskDownloadTaskStatus,
  BaiduNetdiskRemoteOwnershipListing,
  BaiduNetdiskRemotePosterListing,
  BaiduNetdiskRemoteAiProductionProofListing,
  BaiduNetdiskRemoteVideoListing,
  BaiduNetdiskShareDownloadOptions,
  BaiduNetdiskShareDownloadResult,
  CdpTarget,
  Rect,
  ShareInfo,
} from "../domain/types.js";
import { sleep } from "../infrastructure/utils.js";

export { DEFAULT_BAIDU_NETDISK_DOWNLOAD_DIR } from "../domain/constants.js";
export { parseBaiduNetdiskShareText } from "../domain/share-text.js";
export {
  configureBaiduNetdiskAutomationLogging,
  flushBaiduNetdiskAutomationLogs,
} from "../infrastructure/logging.js";
export * from "../domain/errors.js";
export type {
  BaiduNetdiskDownloadTaskStatus,
  BaiduNetdiskRemoteEpisodeFile,
  BaiduNetdiskRemoteOwnershipFile,
  BaiduNetdiskRemoteOwnershipListing,
  BaiduNetdiskRemotePosterListing,
  BaiduNetdiskRemoteVideoListing,
  BaiduNetdiskShareDownloadOptions,
  BaiduNetdiskShareDownloadResult,
  BaiduNetdiskShareInfo,
} from "../domain/types.js";

async function copyToClipboardOnce(text: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        [
          "$ErrorActionPreference = 'Stop'",
          "$utf8 = [Text.UTF8Encoding]::new($false)",
          "[Console]::InputEncoding = $utf8",
          "[Console]::OutputEncoding = $utf8",
          "$OutputEncoding = $utf8",
          "Set-Clipboard -Value ([Console]::In.ReadToEnd())",
        ].join("; "),
      ],
      { stdio: ["pipe", "ignore", "pipe"], windowsHide: true },
    );

    let errorOutput = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      errorOutput += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(errorOutput.trim() || `Set-Clipboard exited with ${code}`));
    });
    child.stdin.end(text, "utf8");
  });
}

async function copyToClipboard(text: string) {
  if (process.platform !== "win32") {
    log("当前不是 Windows，跳过 Set-Clipboard。");
    return { copied: false, error: "当前不是 Windows。" };
  }

  return Effect.runPromise(
    retryWithDelays(
      () => Effect.tryPromise({
        try: () => copyToClipboardOnce(text),
        catch: (error) => error,
      }),
      { delaysMs: [150, 400, 800, 1500] },
    ).pipe(
      Effect.as({ copied: true as const }),
      Effect.catchAll((error) => Effect.succeed({
        copied: false as const,
        error: errorMessage(error),
      })),
    ),
  );
}

function shareId(link: string) {
  const url = new URL(link);
  const id = url.pathname.split("/").pop() ?? "";
  return id.replace(/^1/, "");
}

function shareIdTokens(id: string) {
  return [id, `1${id}`, encodeURIComponent(id), encodeURIComponent(`1${id}`)].filter(Boolean);
}

function includesShareId(value: string, id: string) {
  return shareIdTokens(id).some((token) => value.includes(token));
}

function isShareTarget(target: CdpTarget, id: string) {
  const value = `${target.url}\n${target.title}`;
  return value.includes("pan.baidu.com") && includesShareId(value, id);
}

function isPanTarget(target: CdpTarget) {
  return `${target.url}\n${target.title}`.includes("pan.baidu.com");
}

function isChromeErrorUrl(url: string | undefined) {
  return Boolean(url?.startsWith("chrome-error://"));
}

function isCoreTarget(target: CdpTarget) {
  return target.webSocketDebuggerUrl && target.url.includes("core.asar");
}

function uniqueTargets(targets: CdpTarget[]) {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = target.id || target.webSocketDebuggerUrl || target.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function openShareCandidates(targets: CdpTarget[]) {
  const coreTargets = targets.filter((target) => isCoreTarget(target) && target.type === "page");
  const primaryCoreTargets = coreTargets.filter(
    (target) => !target.url.includes("#/bubble_menu") && !target.url.includes("#/workspace"),
  );
  const panTargets = targets.filter((target) => target.webSocketDebuggerUrl && isPanTarget(target));

  return uniqueTargets([...panTargets, ...primaryCoreTargets, ...coreTargets]);
}

type ShareTargetState = {
  url: string;
  title: string;
};

type ShareReadyState = ShareTargetState & {
  text: string;
  needsCode: boolean;
  captcha: boolean;
  readyForList: boolean;
  failureText: string;
};

async function readTargetShareState(target: CdpTarget) {
  if (!target.webSocketDebuggerUrl) return undefined;

  try {
    return await withPage(target, (page) =>
      page.evaluate<ShareTargetState>(`({ url: location.href, title: document.title })`, 4000),
    );
  } catch {
    return undefined;
  }
}

function shareStateMatches(state: ShareTargetState | undefined, id: string) {
  if (!state) return false;
  const value = `${state.url}\n${state.title}`;
  return value.includes("pan.baidu.com") && includesShareId(value, id);
}

function prioritizeTargets(targets: CdpTarget[], preferredTargets: CdpTarget[]) {
  const preferred = preferredTargets
    .map(
      (preferredTarget) =>
        targets.find((target) => target.id === preferredTarget.id) ?? preferredTarget,
    )
    .filter((target) => target.webSocketDebuggerUrl);
  return uniqueTargets([...preferred, ...targets]);
}

async function findShareTarget(port: number, id: string, preferredTargets: CdpTarget[] = []) {
  const targets = await getTargets(port);
  const candidates = prioritizeTargets(targets, preferredTargets);
  const target = candidates.find((item) => item.webSocketDebuggerUrl && isShareTarget(item, id));
  if (target) {
    const state = await readTargetShareState(target);
    if (!state) return target;
    if (!isChromeErrorUrl(state.url) && shareStateMatches(state, id)) {
      return {
        ...target,
        title: state.title || target.title,
        url: state.url || target.url,
      };
    }
  }

  for (const candidate of candidates) {
    if (!candidate.webSocketDebuggerUrl) continue;
    if (!isPanTarget(candidate) && !preferredTargets.some((target) => target.id === candidate.id))
      continue;

    const state = await readTargetShareState(candidate);
    if (shareStateMatches(state, id)) {
      return {
        ...candidate,
        title: state?.title || candidate.title,
        url: state?.url || candidate.url,
      };
    }
  }

  return undefined;
}

async function waitForShareTarget(
  port: number,
  id: string,
  timeoutMs = 20000,
  preferredTargets: CdpTarget[] = [],
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const target = await findShareTarget(port, id, preferredTargets);
    if (target) return target;
    await sleep(500);
  }

  const targets = await getTargets(port).catch(() => []);
  const summary = targets
    .map((target) => `${target.type}:${compactText(target.title || target.url, 80)}`)
    .join(" | ");
  throw new Error(`没有找到目标页面。当前页面：${summary || "无"}`);
}

async function navigateToShareBestEffort(target: CdpTarget, share: ShareInfo) {
  await withPage(target, async (page) => {
    await page.send("Page.stopLoading", {}, 1500).catch(() => undefined);
    const state = await page
      .evaluate<{ url: string }>(`({ url: location.href })`, 3000)
      .catch(() => undefined);

    if (
      target.url.includes("pan.baidu.com") ||
      state?.url.includes("pan.baidu.com") ||
      isChromeErrorUrl(state?.url)
    ) {
      await page.navigate(share.link, 8000).catch((error) => {
        log(
          `Page.navigate 打开分享链接未返回，继续等待目标页面：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
      return;
    }

    await page.navigate(share.link, 8000).catch((error) => {
      log(
        `Page.navigate 未返回，继续等待目标页面：${error instanceof Error ? error.message : String(error)}`,
      );
    });
  });
}

async function openSharePage(port: number, share: ShareInfo) {
  const id = shareId(share.link);
  const existing = await findShareTarget(port, id);
  if (existing) return existing;

  const targets = await getTargets(port);
  const reusableTargets = openShareCandidates(targets);

  if (reusableTargets.length <= 0) throw new Error("没有找到可导航的百度网盘页面。");

  log("通过 CDP 打开分享链接");
  for (const reusable of reusableTargets) {
    await navigateToShareBestEffort(reusable, share);

    const navigated = await waitForShareTarget(port, id, 12000, [reusable]).catch(() => undefined);
    if (navigated) return navigated;
  }

  return waitForShareTarget(port, id, 25000, reusableTargets);
}

async function enterShareCode(target: CdpTarget, share: ShareInfo) {
  await withPage(target, async (page) => {
    await waitForDocumentBody(page);
    const { pwd } = share;

    const state = await page.evaluate<{
      url: string;
      text: string;
      needsCode: boolean;
    }>(
      `({
  url: location.href,
  text: document.body ? document.body.innerText : "",
  needsCode: Boolean(document.querySelector("#accessCode") && document.querySelector("#submitBtn")),
})`,
    );

    if (!state.needsCode && !state.url.includes("share/init")) return;

    log("输入提取码并提取文件");
    let lastState: { url: string; text: string } | undefined;

    const readState = async () =>
      page
        .evaluate<{ url: string; text: string }>(
          `({ url: location.href, text: document.body ? document.body.innerText : "" })`,
          5000,
        )
        .catch((error) => {
          if (isNavigationDuringEvaluate(error)) return undefined;
          return undefined;
        });

    const waitForExtracted = async (timeoutMs: number) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        await sleep(700);
        const nextState = await readState();
        if (!nextState) return true;
        lastState = nextState;

        if (nextState.url.includes("#list") || nextState.text.includes("全部文件")) return true;
        if (!nextState.url.includes("share/init")) return true;
        if (nextState.text.includes("请输入验证码")) {
          throw new Error("分享页要求验证码，CDP 无法自动完成。");
        }
        if (
          /提取码错误|密码错误|分享不存在|链接不存在|分享已取消|分享已过期/.test(nextState.text)
        ) {
          throw new Error(`分享页提取失败：${compactText(nextState.text)}`);
        }
      }

      return false;
    };

    const verified = await page
      .evaluate<{ ok: boolean; errno?: number; message?: string; text: string; url: string }>(
        `
(async () => {
  const shareLink = ${JSON.stringify(share.link)};
  const pwd = ${JSON.stringify(pwd)};
  const text = () => (document.body ? document.body.innerText : "");
  const currentUrl = new URL(location.href);
  const shareUrl = new URL(shareLink);
  const surl =
    currentUrl.searchParams.get("surl") ||
    shareUrl.pathname.split("/").pop()?.replace(/^1/, "") ||
    "";
  if (!surl) return { ok: false, message: "missing surl", url: location.href, text: text() };

  const getLocal = (key) => {
    try {
      return globalThis.locals?.get?.(key) ?? "";
    } catch {
      return "";
    }
  };
  const token = String(globalThis.yunData?.bdstoken || getLocal("bdstoken") || "");
  const params = new URLSearchParams({
    surl,
    t: String(Date.now()),
    channel: "chunlei",
    web: "1",
    app_id: "250528",
    bdstoken: token,
    clienttype: "0",
  });
  const body = new URLSearchParams({
    pwd,
    vcode: "",
    vcode_str: "",
  });
  const response = await fetch("/share/verify?" + params.toString(), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body,
  });
  const data = await response.json().catch(() => ({ errno: response.status, errmsg: response.statusText }));
  if (data.errno !== 0) {
    return {
      ok: false,
      errno: data.errno,
      message: data.errmsg || data.show_msg || JSON.stringify(data).slice(0, 240),
      url: location.href,
      text: text(),
    };
  }

  const randsk = String(data.randsk || data.sekey || data.bdclnd || "");
  if (randsk) {
    localStorage.setItem(surl + "_bdclnd", randsk);
    document.cookie = "BDCLND=" + encodeURIComponent(randsk) + "; path=/";
  }
  location.assign(shareLink);
  return { ok: true, errno: 0, url: location.href, text: text() };
})()
`,
        20000,
      )
      .catch((error) => {
        if (isNavigationDuringEvaluate(error)) {
          return { ok: true, errno: 0, url: state.url, text: state.text };
        }
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          url: state.url,
          text: state.text,
        };
      });

    // oxlint-disable-next-line no-useless-assignment
    lastState = verified;
    if (verified.ok) {
      if (await waitForExtracted(12000)) return;
      await page.navigate(share.link, 8000).catch((error) => {
        log(
          `提取码接口已通过，重新打开分享列表未返回：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
      if (await waitForExtracted(45000)) return;
    } else {
      log(
        `分享提取接口未直接完成，回退页面按钮：${verified.errno ?? ""} ${verified.message ?? ""}`.trim(),
      );
    }

    const prepared = await page
      .evaluate<{
        ready: boolean;
        rect?: Rect;
        submittedBy?: string;
        url: string;
        text: string;
      }>(`
(() => {
  const text = () => (document.body ? document.body.innerText : "");
  if (!location.href.includes("share/init") && !document.querySelector("#accessCode")) {
    return { ready: true, url: location.href, text: text() };
  }

  const input = document.querySelector("#accessCode");
  const button = document.querySelector("#submitBtn");
  if (!(input instanceof HTMLInputElement) || !(button instanceof HTMLElement)) {
    return { ready: false, url: location.href, text: text() };
  }

  input.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, ${JSON.stringify(pwd)});
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keyup", {
    key: ${JSON.stringify(pwd[pwd.length - 1] ?? "")},
    bubbles: true,
    cancelable: true,
  }));

  button.scrollIntoView({ block: "center", inline: "center" });
  const rect = button.getBoundingClientRect();
  return {
    ready: true,
    submittedBy: "cdp-click",
    url: location.href,
    text: text(),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
})()
`)
      .catch((error) => {
        if (isNavigationDuringEvaluate(error)) {
          return {
            ready: true,
            rect: undefined,
            submittedBy: "navigation",
            url: state.url,
            text: state.text,
          };
        }

        throw error;
      });
    lastState = prepared;
    if (!prepared.ready) throw new Error("没有找到提取文件按钮。");
    if (!prepared.url.includes("share/init")) return;

    if (prepared.rect && prepared.rect.x >= 0 && prepared.rect.y >= 0) {
      try {
        await page.clickPoint(
          prepared.rect.x + prepared.rect.width / 2,
          prepared.rect.y + prepared.rect.height / 2,
        );
      } catch (error) {
        if (isNavigationDuringEvaluate(error)) return;
        throw error;
      }
    }

    if (await waitForExtracted(12000)) return;

    if (prepared.rect && prepared.rect.x >= 0 && prepared.rect.y >= 0) {
      await page.pressEnter().catch(() => undefined);
      await page
        .clickPoint(
          prepared.rect.x + prepared.rect.width / 2,
          prepared.rect.y + prepared.rect.height / 2,
        )
        .catch(() => undefined);
    }

    if (await waitForExtracted(45000)) return;

    if (lastState?.text.includes("提取中")) {
      throw new Error(
        `分享页长时间停在提取中，可能是百度接口响应慢或账号风控。url=${
          lastState.url
        }；页面文本=${compactText(lastState.text)}`,
      );
    }

    throw new Error(
      `提取码已填写但分享页没有跳转。url=${lastState?.url ?? state.url}；页面文本=${compactText(
        lastState?.text ?? state.text,
      )}`,
    );
  });
}

function compactText(text: string, maxLength = 240) {
  return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function isNavigationDuringEvaluate(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Execution context was destroyed") ||
    message.includes("Cannot find context") ||
    message.includes("Inspected target navigated") ||
    message.includes("Target closed")
  );
}

async function readShareReadyState(target: CdpTarget) {
  if (!target.webSocketDebuggerUrl) return undefined;

  try {
    return await withPage(target, (page) =>
      page.evaluate<ShareReadyState>(
        `
(() => {
  const text = document.body ? document.body.innerText : "";
  const failureText =
    text.match(/(提取码错误|密码错误|分享不存在|链接不存在|分享已取消|分享已过期|文件已被删除)[^\\n]*/)?.[0] || "";

  return {
    url: location.href,
    title: document.title,
    text,
    needsCode: Boolean(document.querySelector("#accessCode") && document.querySelector("#submitBtn")),
    captcha: text.includes("请输入验证码"),
    readyForList: location.href.includes("#list") || text.includes("全部文件"),
    failureText,
  };
})()
`,
        6000,
      ),
    );
  } catch (error) {
    if (isNavigationDuringEvaluate(error)) return undefined;
    return undefined;
  }
}

function targetWithShareState(target: CdpTarget, state: ShareReadyState) {
  return {
    ...target,
    title: state.title || target.title,
    url: state.url || target.url,
  };
}

async function waitForShareReadyTarget(
  port: number,
  share: ShareInfo,
  preferredTargets: CdpTarget[] = [],
  timeoutMs = 45000,
) {
  const id = shareId(share.link);
  const started = Date.now();
  let lastState: ShareReadyState | undefined;
  let sawTarget = false;

  while (Date.now() - started < timeoutMs) {
    const target = await findShareTarget(port, id, preferredTargets);
    if (!target) {
      await sleep(500);
      continue;
    }

    sawTarget = true;
    const state = await readShareReadyState(target);
    if (!state) {
      await sleep(500);
      continue;
    }
    lastState = state;

    if (state.captcha) throw new Error("分享页要求验证码，CDP 无法自动完成。");
    if (state.failureText) throw new Error(`分享页提取失败：${state.failureText}`);

    if (state.readyForList) return targetWithShareState(target, state);

    await sleep(500);
  }

  const stateSummary = lastState
    ? `url=${lastState.url}；readyForList=${lastState.readyForList}；needsCode=${lastState.needsCode}；页面文本=${compactText(lastState.text)}`
    : sawTarget
      ? "已找到分享页，但页面状态无法读取。"
      : "没有找到分享页 target。";
  throw new Error(`没有进入分享文件列表。${stateSummary}`);
}

async function waitForShareList(
  port: number,
  share: ShareInfo,
  preferredTargets: CdpTarget[] = [],
) {
  return waitForShareReadyTarget(port, share, preferredTargets, 45000);
}

type SavedShareResult = {
  fileName: string;
  savedPath: string;
  fsId: number | string;
  resourceRootName: string;
  resourceRootPath: string;
  resourceRootFsId: number | string;
  alreadySaved: boolean;
  locateSource: string;
  shareStructure: "wrapped" | "flat";
  transferredItemCount: number;
  remoteVideos: BaiduNetdiskRemoteVideoListing;
  remoteOwnership: BaiduNetdiskRemoteOwnershipListing;
  remotePosters: BaiduNetdiskRemotePosterListing;
  remoteAiProductionProofs: BaiduNetdiskRemoteAiProductionProofListing;
};

type SaveShareOptions = {
  isolatedRoot?: boolean;
  isolatedRootUnique?: boolean;
};

async function saveShareToOwnNetdisk(target: CdpTarget, share: ShareInfo, options: SaveShareOptions = {}) {
  return withPage(target, async (page) => {
    log(options.isolatedRoot ? "保存分享目录到干净的网盘中转目录" : "保存分享目录到我的网盘");
    const stopConsoleForwarding = page.onConsole((message) => {
      const prefix = ["[baidu-transfer] ", "[baidu] "].find((candidate) => message.startsWith(candidate));
      if (!prefix) return;
      const forwardedMessage = message.slice(prefix.length);
      if (/失败|超时|未匹配|重试/.test(forwardedMessage)) warn(forwardedMessage);
      else log(forwardedMessage);
    });
    try {
      // The console calls inside this injected script are its message bridge back to the logger above.
      const result = await page.evaluate<SavedShareResult>(
      `
(async () => {
  const SHARE_LIST_MAX_PAGES = ${SHARE_LIST_MAX_PAGES};
  const OWN_NETDISK_DIR_LIST_MAX_PAGES = ${OWN_NETDISK_DIR_LIST_MAX_PAGES};
  const OWN_NETDISK_DIR_LIST_PAGE_SIZE = ${OWN_NETDISK_DIR_LIST_PAGE_SIZE};
  const REMOTE_DIR_ENTRY_SAMPLE_LIMIT = ${REMOTE_DIR_ENTRY_SAMPLE_LIMIT};
  const REMOTE_VIDEO_SCAN_MAX_DEPTH = ${REMOTE_VIDEO_SCAN_MAX_DEPTH};
  const REMOTE_VIDEO_SCAN_MAX_DIRS = ${REMOTE_VIDEO_SCAN_MAX_DIRS};

  for (const item of document.querySelectorAll(
    ".dialog-close,#dialog1 .close,#moduleDownloadDialog .dialog-close,.nd-dialog-close",
  )) {
    if (item instanceof HTMLElement) item.click();
  }

  const shareLink = ${JSON.stringify(share.link)};
  const pwd = ${JSON.stringify(share.pwd)};
  let expectedName = ${JSON.stringify(share.name)};
  const isolateRoot = ${JSON.stringify(options.isolatedRoot ?? false)};
  const isolateRootUnique = ${JSON.stringify(options.isolatedRootUnique ?? false)};
  const shouldUseSourceName = ${JSON.stringify(share.name === DEFAULT_BAIDU_NETDISK_SHARE_NAME)};
  const shareUrl = new URL(shareLink);
  const surl = shareUrl.pathname.split("/s/")[1]?.replace(/^1/, "") || "";
  if (!surl) throw new Error("分享链接没有解析出 surl。");

  const getLocal = (key) => {
    try {
      return globalThis.locals?.get?.(key) ?? "";
    } catch {
      return "";
    }
  };
  const jsonFetch = async (url, init) => {
    const response = await fetch(url, { credentials: "include", ...init });
    const data = await response.json();
    return data;
  };
  const compactJson = (value) => {
    try {
      return JSON.stringify(value).replace(/\\s+/g, " ").slice(0, 800);
    } catch {
      return String(value).slice(0, 800);
    }
  };
  const readBalancedObject = (text, marker, fromIndex = 0) => {
    const markerIndex = text.indexOf(marker, fromIndex);
    if (markerIndex < 0) return undefined;
    const start = text.indexOf("{", markerIndex + marker.length);
    if (start < 0) return undefined;

    let depth = 0;
    let quote = "";
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\\\") {
          escaped = true;
        } else if (char === quote) {
          quote = "";
        }
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) return { value: text.slice(start, index + 1), nextIndex: index + 1 };
      }
    }
    return undefined;
  };
  const parseLocalsFromHtml = (html) => {
    const parsed = [];
    let fromIndex = 0;
    while (fromIndex < html.length) {
      const objectText = readBalancedObject(html, "locals.mset(", fromIndex);
      if (!objectText) break;
      fromIndex = objectText.nextIndex;
      try {
        parsed.push(JSON.parse(objectText.value));
      } catch {
        // Ignore non-JSON locals blocks.
      }
    }
    return parsed;
  };
  const pickString = (...values) => {
    for (const value of values) {
      if (value !== undefined && value !== null && String(value)) return String(value);
    }
    return "";
  };
  const matchString = (text, pattern) => text.match(pattern)?.[1] || "";

  const verifyParams = new URLSearchParams({
    surl,
    t: String(Date.now()),
    channel: "chunlei",
    web: "1",
    app_id: "250528",
    bdstoken: String(getLocal("bdstoken") || ""),
    clienttype: "0",
  });
  const verifyBody = new URLSearchParams({
    pwd,
    vcode: "",
    vcode_str: "",
  });
  const verified = await jsonFetch("/share/verify?" + verifyParams.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: verifyBody,
  });
  if (verified.errno !== 0) {
    throw new Error("分享提取码校验失败：" + compactJson(verified));
  }

  const randsk = String(verified.randsk || verified.sekey || verified.bdclnd || "");
  if (randsk) {
    localStorage.setItem(surl + "_bdclnd", randsk);
    document.cookie = "BDCLND=" + encodeURIComponent(randsk) + "; path=/";
  }

  const sharePageResponse = await fetch(shareLink, { credentials: "include" });
  const sharePageHtml = await sharePageResponse.text();
  if (!sharePageResponse.ok) {
    throw new Error("分享页 HTML 请求失败：" + sharePageResponse.status + " " + sharePageResponse.statusText);
  }

  const localsBlocks = parseLocalsFromHtml(sharePageHtml);
  const pageData = (() => {
    try {
      return globalThis.yunData && typeof globalThis.yunData === "object" ? globalThis.yunData : {};
    } catch {
      return {};
    }
  })();
  const fileNameOf = (item) => String(item?.server_filename || item?.filename || item?.path?.split("/")?.pop() || "");
  const fileFsIdOf = (item) => item?.fs_id || item?.fsid || item?.id;
  const fileListOf = (item) => Array.isArray(item?.file_list) ? item.file_list : [];
  const blockShareId = (item) => pickString(item?.shareid, item?.share_id);
  const blockShareUk = (item) => pickString(item?.share_uk, item?.shareuk, item?.uk);
  const blockToken = (item) => pickString(item?.bdstoken, item?.bdstoken_value);
  const normalizeDir = (dir) => "/" + String(dir || "").split("/").filter(Boolean).join("/");
  const isExpectedFile = (item) => {
    const name = fileNameOf(item);
    return name === expectedName || Boolean(name && (name.includes(expectedName) || expectedName.includes(name)));
  };
  const candidates = [pageData, ...localsBlocks].filter((item) => item && typeof item === "object");
  const completeFileBlock =
    candidates.find((item) => fileListOf(item).some(isExpectedFile) && blockShareId(item) && blockShareUk(item)) ||
    candidates.find((item) => fileListOf(item).length > 0 && blockShareId(item) && blockShareUk(item)) ||
    {};
  const fallbackFileBlock =
    candidates.find((item) => fileListOf(item).some(isExpectedFile)) ||
    candidates.find((item) => fileListOf(item).length > 0) ||
    {};
  const metadataBlock =
    completeFileBlock && (blockShareId(completeFileBlock) || blockShareUk(completeFileBlock))
      ? completeFileBlock
      : candidates.find((item) => blockShareId(item) && blockShareUk(item)) || {};
  const token = pickString(
    blockToken(metadataBlock),
    blockToken(fallbackFileBlock),
    getLocal("bdstoken"),
    matchString(sharePageHtml, /bdstoken["']?\\s*[:=]\\s*["']([^"']+)/),
  );
  const shareId = pickString(
    blockShareId(metadataBlock),
    blockShareId(fallbackFileBlock),
    matchString(sharePageHtml, /shareid["']?\\s*[:=]\\s*["']?(\\d+)/),
  );
  const shareUk = pickString(
    blockShareUk(metadataBlock),
    blockShareUk(fallbackFileBlock),
    matchString(sharePageHtml, /share_uk["']?\\s*[:=]\\s*["']?(\\d+)/),
  );
  if (!shareId || !shareUk) {
    throw new Error("分享页 HTML 没有解析到 shareid/share_uk，无法保存到我的网盘。");
  }
  const shareListAttempts = [];
  const fetchShareFileList = async (dir = "/") => {
    const results = [];
    const pageSize = 1000;
    for (let page = 1; page <= SHARE_LIST_MAX_PAGES; page += 1) {
      const params = new URLSearchParams({
        uk: shareUk,
        shareid: shareId,
        order: "other",
        desc: "1",
        showempty: "0",
        web: "1",
        page: String(page),
        num: String(pageSize),
        dir: normalizeDir(dir),
        t: String(Date.now()),
        channel: "chunlei",
        app_id: "250528",
        bdstoken: token,
        clienttype: "0",
      });
      const data = await jsonFetch("/share/list?" + params.toString());
      if (data.errno !== 0) {
        shareListAttempts.push("page=" + page + " errno=" + data.errno + " " + compactJson(data));
        break;
      }
      const list = Array.isArray(data.list) ? data.list : [];
      results.push(...list);
      if (list.length < pageSize && !data.has_more) break;
    }
    return results;
  };
  let apiFileList = [];
  try {
    apiFileList = await fetchShareFileList();
  } catch (error) {
    shareListAttempts.push("error=" + String(error?.message || error));
  }
  const htmlFileList = fileListOf(completeFileBlock).length > 0
    ? fileListOf(completeFileBlock)
    : fileListOf(fallbackFileBlock);
  const fileList = apiFileList.length > 0 ? apiFileList : htmlFileList;
  const transferableFiles = fileList.filter((item) => Boolean(fileFsIdOf(item)));
  if (transferableFiles.length === 0) {
    throw new Error(
      "分享页没有解析到可转存文件元数据，无法保存到我的网盘。share/list=" +
        shareListAttempts.slice(-5).join(" | ")
    );
  }
  const sourceNames = transferableFiles.map(fileNameOf).filter(Boolean);
  const sourceName =
    sourceNames.find((name) => name === expectedName) ||
    sourceNames.find((name) => name.includes(expectedName) || expectedName.includes(name)) ||
    sourceNames[0] ||
    expectedName;
  if (shouldUseSourceName && sourceNames.length === 1 && sourceName) {
    expectedName = sourceName;
  }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const attempts = [];
  const itemName = (item) => String(item?.server_filename || item?.path?.split("/")?.pop() || "");
  const itemPath = (item) => String(item?.path || "");
  const itemFsId = (item) => String(item?.fs_id || item?.fsid || item?.id || "");
  const joinPath = (dir, name) => normalizeDir(normalizeDir(dir) + "/" + name);
  const itemIsDir = (item) => Number(item?.isdir ?? item?.is_dir ?? 0) === 1;
  const itemSize = (item) => Number(item?.size ?? 0);
  const compatibleItem = (source, target) => {
    if (itemIsDir(source) !== itemIsDir(target)) return false;
    if (itemIsDir(source)) return true;
    const sourceSize = itemSize(source);
    const targetSize = itemSize(target);
    return sourceSize <= 0 || targetSize <= 0 || sourceSize === targetSize;
  };
  const ownDirListCache = new Map();
  const ownDirListFailureMessage = (dir, data) => {
    const apiMessage = String(data?.show_msg || data?.errmsg || data?.message || "");
    const hint =
      data?.errno === 1 || data?.errno === 4
        ? "。通常是百度网盘客户端登录态、bdstoken 或接口临时风控异常；请先确认客户端已登录，必要时重启为 CDP 模式后重试"
        : "";
    return (
      "读取我的网盘目录失败：" +
      dir +
      "；" +
      (apiMessage ? apiMessage + "；" : "") +
      "errno=" +
      String(data?.errno ?? "-") +
      (data?.request_id ? "；request_id=" + String(data.request_id) : "") +
      hint +
      "；" +
      compactJson(data)
    );
  };
  const fetchOwnDirPage = async (normalizedDir, page) => {
    const params = new URLSearchParams({
      dir: normalizedDir,
      order: "name",
      desc: "0",
      showempty: "0",
      num: String(OWN_NETDISK_DIR_LIST_PAGE_SIZE),
      page: String(page),
      t: String(Date.now()),
      channel: "chunlei",
      web: "1",
      app_id: "250528",
      bdstoken: token,
      clienttype: "0",
    });
    let lastData;
    for (const retryDelay of [0, 800, 1800]) {
      if (retryDelay > 0) await sleep(retryDelay);
      const data = await jsonFetch("/api/list?" + params.toString());
      lastData = data;
      if (data.errno === 0 || (data.errno !== 1 && data.errno !== 4)) return data;
      console.log(
        "[baidu-transfer] 读取我的网盘目录临时失败，准备重试：" +
          normalizedDir +
          " page=" +
          page +
          " errno=" +
          data.errno +
          (data.request_id ? " request_id=" + String(data.request_id) : ""),
      );
    }
    return lastData;
  };
  const listOwnDir = async (dir, forceRefresh = false) => {
    const normalizedDir = normalizeDir(dir);
    if (!forceRefresh && ownDirListCache.has(normalizedDir)) {
      return ownDirListCache.get(normalizedDir);
    }
    const results = [];
    for (let page = 1; page <= OWN_NETDISK_DIR_LIST_MAX_PAGES; page += 1) {
      const data = await fetchOwnDirPage(normalizedDir, page);
      if (data.errno !== 0) {
        throw new Error(ownDirListFailureMessage(normalizedDir, data));
      }
      const list = Array.isArray(data.list) ? data.list : [];
      results.push(...list);
      if (list.length < OWN_NETDISK_DIR_LIST_PAGE_SIZE && !data.has_more) break;
    }
    ownDirListCache.set(normalizedDir, results);
    return results;
  };
  const safeExpectedName = String(expectedName || sourceName || "百度网盘资源")
    .replace(/[\\\\/:*?"<>|]/g, "_")
    .slice(0, 180);
  const materialDirectoryPattern = /^(成片|成品|视频|正片|工程|工程文件|权属|权属文件|版权|海报|封面|AI制作证明)$/i;
  const topLevelDirectories = transferableFiles.filter(itemIsDir);
  const wrapperCandidate = transferableFiles.length === 1 && topLevelDirectories.length === 1
    ? topLevelDirectories[0]
    : undefined;
  const wrapperName = wrapperCandidate ? fileNameOf(wrapperCandidate) : "";
  const shareHasDramaWrapper = Boolean(
    wrapperCandidate &&
      (
        wrapperName === expectedName ||
        wrapperName.includes(expectedName) ||
        expectedName.includes(wrapperName) ||
        !materialDirectoryPattern.test(wrapperName.replace(/\\s+/g, ""))
      ),
  );
  let desiredItems = shareHasDramaWrapper
    ? await fetchShareFileList(itemPath(wrapperCandidate))
    : transferableFiles;
  desiredItems = desiredItems.filter((item) => Boolean(fileFsIdOf(item)));
  if (desiredItems.length === 0) {
    throw new Error(
      shareHasDramaWrapper
        ? "分享中的剧名目录为空或无法读取：" + itemPath(wrapperCandidate)
        : "分享根目录没有可转存素材。",
    );
  }

  const sekey =
    localStorage.getItem(surl + "_bdclnd") ||
    (document.cookie.match(/(?:^|; )BDCLND=([^;]+)/) || [])[1] ||
    "";
  const transferParams = new URLSearchParams({
    shareid: shareId,
    from: shareUk,
    sekey: decodeURIComponent(sekey),
    ondup: "newcopy",
    async: "1",
    channel: "chunlei",
    web: "1",
    app_id: "250528",
    bdstoken: token,
    clienttype: "0",
  });

  const findOwnItem = async (dir, name, forceRefresh = false) =>
    (await listOwnDir(dir, forceRefresh)).find((item) => itemName(item) === name);
  const searchOwnItems = async (name) => {
    const results = [];
    const pageSize = 1000;
    for (let page = 1; page <= OWN_NETDISK_DIR_LIST_MAX_PAGES; page += 1) {
      const params = new URLSearchParams({
        key: String(name),
        recursion: "1",
        order: "name",
        desc: "0",
        num: String(pageSize),
        page: String(page),
        channel: "chunlei",
        web: "1",
        app_id: "250528",
        bdstoken: token,
        clienttype: "0",
      });
      const data = await jsonFetch("/api/search?" + params.toString());
      if (data.errno !== 0) {
        attempts.push("search own item errno=" + data.errno + " name=" + name);
        break;
      }
      const list = Array.isArray(data.list) ? data.list : [];
      results.push(...list.filter((item) => itemName(item) === name));
      if (!data.has_more || list.length < pageSize) break;
    }
    return results;
  };
  const createOwnDirectory = async (name) => {
    const targetPath = joinPath("/", name);
    const existing = await findOwnItem("/", name);
    if (existing) {
      if (!itemIsDir(existing)) {
        throw new Error("我的网盘存在同名文件，不能作为剧目目录：" + targetPath);
      }
      return existing;
    }

    const createParams = new URLSearchParams({
      a: "commit",
      channel: "chunlei",
      web: "1",
      app_id: "250528",
      bdstoken: token,
      clienttype: "0",
    });
    const createBody = new URLSearchParams({
      path: targetPath,
      isdir: "1",
      block_list: "[]",
      method: "post",
    });
    const created = await jsonFetch("/api/create?" + createParams.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: createBody,
    });
    if (created.errno === 0) {
      ownDirListCache.delete("/");
      return created;
    }
    if (created.errno === 2) {
      const collided = await findOwnItem("/", name);
      if (collided && itemIsDir(collided)) return collided;
    } else {
      throw new Error(
        "创建网盘剧目录失败：" +
          String(created.show_msg || created.errmsg || created.message || "百度接口返回异常") +
          "；errno=" +
          String(created.errno),
      );
    }
    throw new Error(
      "创建网盘剧目录发生冲突但未找到可复用目录：" + targetPath + "；" + compactJson(created),
    );
  };
  const waitForOwnItem = async (source, destinationDir, timeoutMs) => {
    const name = fileNameOf(source);
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const located = await findOwnItem(destinationDir, name, true);
      if (located) {
        if (!compatibleItem(source, located)) {
          const conflict = new Error("转存后出现不兼容的同名素材：" + joinPath(destinationDir, name));
          conflict.code = "TARGET_CONFLICT";
          throw conflict;
        }
        return located;
      }
      await sleep(1500);
    }
    return undefined;
  };
  const transferOne = async (source, destinationDir) => {
    const name = fileNameOf(source);
    const existing = await findOwnItem(destinationDir, name);
    if (existing) {
      if (!compatibleItem(source, existing)) {
        const conflict = new Error("目标目录存在不兼容的同名素材：" + joinPath(destinationDir, name));
        conflict.code = "TARGET_CONFLICT";
        throw conflict;
      }
      return { item: existing, transferred: false };
    }

    const transferBody = new URLSearchParams({
      fsidlist: JSON.stringify([fileFsIdOf(source)]),
      path: normalizeDir(destinationDir),
    });
    const timeoutRequestIds = [];
    for (let transferAttempt = 1; transferAttempt <= 2; transferAttempt += 1) {
      console.log(
        "[baidu-transfer] 提交网盘转存：" +
          name +
          (transferAttempt > 1 ? "（第" + transferAttempt + "次尝试）" : ""),
      );
      const transferred = await jsonFetch("/share/transfer?" + transferParams.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: transferBody,
      });
      const message = String(transferred.show_msg || transferred.errmsg || transferred.message || "");
      if (transferred.errno === -6 || message.includes("账户已过期") || message.includes("重新登陆")) {
        throw new Error("百度网盘账号登录已过期，请在百度网盘客户端重新登录后再下载。");
      }
      if (transferred.errno === 4) {
        if (transferred.request_id) timeoutRequestIds.push(String(transferred.request_id));
        console.log(
          "[baidu-transfer] 百度转存接口超时，正在回查后台结果：" +
            name +
            (transferred.request_id ? "，request_id=" + String(transferred.request_id) : ""),
        );
        const locatedAfterTimeout = await waitForOwnItem(source, destinationDir, 20000);
        if (locatedAfterTimeout) {
          console.log("[baidu-transfer] 已确认后台转存完成：" + name);
          return { item: locatedAfterTimeout, transferred: true };
        }
        if (transferAttempt < 2) {
          console.log("[baidu-transfer] 后台暂未发现素材，准备安全重试：" + name);
          await sleep(5000);
          const locatedBeforeRetry = await findOwnItem(destinationDir, name, true);
          if (locatedBeforeRetry) {
            if (!compatibleItem(source, locatedBeforeRetry)) {
              const conflict = new Error("重试前发现不兼容的同名素材：" + joinPath(destinationDir, name));
              conflict.code = "TARGET_CONFLICT";
              throw conflict;
            }
            return { item: locatedBeforeRetry, transferred: true };
          }
          continue;
        }
        throw new Error(
          "保存分享到网盘失败：百度接口连续超时，且目标目录未发现素材；errno=4" +
            (timeoutRequestIds.length > 0 ? "；request_id=" + timeoutRequestIds.join(",") : "") +
            "；目标=" +
            joinPath(destinationDir, name),
        );
      }
      if (transferred.errno !== 0 && transferred.errno !== 2) {
        throw new Error(
          "保存分享到网盘失败：" +
            (message || "百度接口返回异常") +
            "；errno=" +
            String(transferred.errno) +
            (transferred.request_id ? "；request_id=" + String(transferred.request_id) : ""),
        );
      }
      if (transferred.errno === 2) {
        const locatedDuplicate = await waitForOwnItem(source, destinationDir, 5000);
        if (locatedDuplicate) return { item: locatedDuplicate, transferred: false };
        const existingElsewhere = (await searchOwnItems(name))
          .filter((item) => compatibleItem(source, item))
          .map(itemPath)
          .filter(Boolean);
        if (existingElsewhere.length > 0) {
          const duplicate = new Error(
            "素材已存在于网盘其他目录，当前剧目目录无法继续补传：" +
              name +
              "；现有路径=" +
              existingElsewhere.slice(0, 5).join("、"),
          );
          duplicate.code = "SOURCE_ALREADY_SAVED_ELSEWHERE";
          throw duplicate;
        }
      }

      const located = await waitForOwnItem(source, destinationDir, 70000);
      if (located) return { item: located, transferred: transferred.errno === 0 };
      throw new Error(
        (transferred.errno === 2 ? "文件已存在但目标目录未找到对应素材：" : "转存后未找到目标素材：") +
          joinPath(destinationDir, name),
      );
    }
    throw new Error("保存分享到网盘失败：转存重试流程异常结束；目标=" + joinPath(destinationDir, name));
  };
  const itemsConflict = async (source, target) => {
    if (!compatibleItem(source, target)) return true;
    if (!itemIsDir(source)) return false;

    const sourceChildren = await fetchShareFileList(itemPath(source));
    const targetChildrenByName = new Map(
      (await listOwnDir(itemPath(target))).map((item) => [itemName(item), item]),
    );
    for (const sourceChild of sourceChildren) {
      const targetChild = targetChildrenByName.get(fileNameOf(sourceChild));
      if (targetChild && await itemsConflict(sourceChild, targetChild)) return true;
    }
    return false;
  };
  const destinationHasConflict = async (destinationDir, sources) => {
    const existingByName = new Map(
      (await listOwnDir(destinationDir)).map((item) => [itemName(item), item]),
    );
    for (const source of sources) {
      const existing = existingByName.get(fileNameOf(source));
      if (existing && await itemsConflict(source, existing)) return true;
    }
    return false;
  };
  const inspectReusableDirectory = async (sources, destinationDir) => {
    const existingByName = new Map(
      (await listOwnDir(destinationDir)).map((item) => [itemName(item), item]),
    );
    let matched = 0;
    let total = 0;
    for (const source of sources) {
      total += 1;
      const existing = existingByName.get(fileNameOf(source));
      if (!existing) continue;
      if (!compatibleItem(source, existing)) {
        return { matched, total, conflict: true };
      }
      matched += 1;
      if (itemIsDir(source)) {
        const sourceChildren = await fetchShareFileList(itemPath(source));
        const nested = await inspectReusableDirectory(sourceChildren, itemPath(existing));
        matched += nested.matched;
        total += nested.total;
        if (nested.conflict) return { matched, total, conflict: true };
      }
    }
    return { matched, total, conflict: false };
  };
  const syncItems = async (sources, destinationDir) => {
    let transferredCount = 0;
    console.log(
      "[baidu-transfer] 检查增量转存目录：" +
        normalizeDir(destinationDir) +
        "，项目数=" +
        sources.length,
    );
    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
      const source = sources[sourceIndex];
      const existing = await findOwnItem(destinationDir, fileNameOf(source));
      if (existing && itemIsDir(source) && itemIsDir(existing)) {
        const sourceChildren = await fetchShareFileList(itemPath(source));
        transferredCount += await syncItems(sourceChildren, itemPath(existing));
        continue;
      }
      if (!existing) {
        console.log(
          "[baidu-transfer] 增量补传 " +
            (sourceIndex + 1) +
            "/" +
            sources.length +
            "：" +
            fileNameOf(source),
        );
      }
      const result = await transferOne(source, destinationDir);
      if (result.transferred) transferredCount += 1;
    }
    return transferredCount;
  };

  const stableSuffix = String(surl || shareId).replace(/[^a-zA-Z0-9]/g, "").slice(-10) || "share";
  let finalFileName = String(shareHasDramaWrapper ? wrapperName : safeExpectedName)
    .replace(/[\\\\/:*?"<>|]/g, "_")
    .slice(0, 180);
  if (isolateRoot) {
    const isolatedBase = (safeExpectedName + "__" + stableSuffix).slice(0, 170);
    const uniqueSuffix = isolateRootUnique ? "__" + Date.now().toString(36).slice(-8) : "";
    finalFileName = (isolatedBase + uniqueSuffix).slice(0, 180);
  }
  const rootCandidate = isolateRoot ? undefined : await findOwnItem("/", finalFileName);
  const searchedCandidates = isolateRoot ? [] : (await searchOwnItems(finalFileName))
    .filter((item) => itemIsDir(item) && itemName(item) === finalFileName);
  const candidateByPath = new Map();
  for (const candidate of [rootCandidate, ...searchedCandidates].filter(Boolean)) {
    if (!itemIsDir(candidate)) continue;
    candidateByPath.set(normalizeDir(itemPath(candidate)), candidate);
  }
  const rankedCandidates = [];
  for (const candidate of candidateByPath.values()) {
    const inspected = await inspectReusableDirectory(desiredItems, itemPath(candidate));
    if (!inspected.conflict) rankedCandidates.push({ item: candidate, ...inspected });
  }
  rankedCandidates.sort((left, right) => {
    const leftComplete = left.matched === left.total && left.total > 0 ? 1 : 0;
    const rightComplete = right.matched === right.total && right.total > 0 ? 1 : 0;
    if (leftComplete !== rightComplete) return rightComplete - leftComplete;
    if (left.matched !== right.matched) return right.matched - left.matched;
    const leftIsRoot = normalizeDir(itemPath(left.item)) === joinPath("/", finalFileName) ? 1 : 0;
    const rightIsRoot = normalizeDir(itemPath(right.item)) === joinPath("/", finalFileName) ? 1 : 0;
    return rightIsRoot - leftIsRoot;
  });
  const bestReusableCandidate = rankedCandidates[0];
  let ownRoot =
    bestReusableCandidate && bestReusableCandidate.matched > 0
      ? bestReusableCandidate.item
      : rootCandidate;
  let locateSource = ownRoot
    ? normalizeDir(itemPath(ownRoot)) === joinPath("/", finalFileName)
      ? "existing-root"
      : "existing-search"
    : "";
  let transferredCount = 0;
  let createdTarget = false;
  let directWrapperTransfer = false;

  if (!ownRoot && isolateRoot) {
    ownRoot = await createOwnDirectory(finalFileName);
    createdTarget = true;
    locateSource = "created-isolated-root";
  }

  if (ownRoot && !itemIsDir(ownRoot)) {
    ownRoot = undefined;
    locateSource = "root-name-conflict";
  }
  if (
    ownRoot &&
    await destinationHasConflict(itemPath(ownRoot), desiredItems)
  ) {
    ownRoot = undefined;
    locateSource = "root-content-conflict";
  }

  if (!ownRoot && !isolateRoot && shareHasDramaWrapper && !locateSource) {
    const directResult = await transferOne(wrapperCandidate, "/");
    ownRoot = directResult.item;
    transferredCount += directResult.transferred ? 1 : 0;
    directWrapperTransfer = true;
    locateSource = directResult.transferred ? "transferred-wrapper" : "existing-wrapper";
  }

  if (!ownRoot) {
    if (locateSource) finalFileName = (safeExpectedName + "__" + stableSuffix).slice(0, 180);
    ownRoot = await findOwnItem("/", finalFileName);
    if (ownRoot && !itemIsDir(ownRoot)) {
      throw new Error("稳定网盘中转路径被同名文件占用：" + joinPath("/", finalFileName));
    }
    if (!ownRoot) {
      ownRoot = await createOwnDirectory(finalFileName);
      createdTarget = true;
    }
    locateSource = locateSource
      ? createdTarget ? "created-conflict-wrapper" : "existing-conflict-wrapper"
      : createdTarget ? "created-flat-wrapper" : "existing-flat-wrapper";
  }

  let savedPath = normalizeDir(itemPath(ownRoot) || joinPath("/", finalFileName));
  finalFileName = itemName(ownRoot) || savedPath.split("/").filter(Boolean).pop() || finalFileName;
  if (!directWrapperTransfer) {
    transferredCount += await syncItems(desiredItems, savedPath);
  }
  const expectedTransferredNames = new Set(desiredItems.map(fileNameOf).filter(Boolean));
  const actualTransferredNames = new Set((await listOwnDir(savedPath)).map(itemName));
  const missingTransferredNames = [...expectedTransferredNames].filter(
    (name) => !actualTransferredNames.has(name),
  );
  if (missingTransferredNames.length > 0) {
    throw new Error(
      "分享资源转存不完整：目标目录=" +
        savedPath +
        "；缺少=" +
        missingTransferredNames.slice(0, 10).join("、") +
        (missingTransferredNames.length > 10 ? "等" + missingTransferredNames.length + "项" : ""),
    );
  }
  const alreadySaved = !createdTarget && transferredCount === 0;
  const escapeRegExp = (value) => String(value).replace(/[\\\\^$.*+?()[\\]{}|]/g, "\\\\$&");
  const episodeBaseNames = [...new Set([expectedName, sourceName, ...sourceNames, finalFileName].filter(Boolean))];
  const episodePatterns = episodeBaseNames.flatMap((baseName) => {
    const escaped = escapeRegExp(baseName);
    return [
      new RegExp("^" + escaped + "\\\\s*[-_—–]?\\\\s*第(\\\\d+)集.*\\\\.mp4$", "i"),
      new RegExp("^" + escaped + "\\\\s*(\\\\d+)\\\\s*集?.*\\\\.mp4$", "i"),
    ];
  });
  episodePatterns.push(
    /^第(\\d+)集.*\\.mp4$/i,
    /^(?:ep|episode|e)[\\s._-]*(\\d+)\\.mp4$/i,
    /^(\\d+)\\.mp4$/i,
  );
  const matchEpisodeIndex = (fileName) => {
    const strongMatch = episodePatterns
      .map((pattern) => pattern.exec(fileName))
      .find((result) => result !== null);
    if (strongMatch) return Number(strongMatch[1]);

    const stem = String(fileName).replace(/\\.[^.]+$/, "");
    const trailingNumberMatch = stem.match(/(\\d{1,4})\\s*(?:集|episode|ep|e)?\\s*$/i);
    if (!trailingNumberMatch) return undefined;

    const index = Number(trailingNumberMatch[1]);
    return Number.isInteger(index) && index > 0 ? index : undefined;
  };
  const listDir = async (dir) => {
    const results = [];
    const normalizedDir = normalizeDir(dir);
    const debug = {
      path: normalizedDir,
      name: normalizedDir.split("/").filter(Boolean).pop() || normalizedDir,
      fsId: "",
      errno: undefined,
      count: 0,
      fileCount: 0,
      fileSizeBytes: 0,
      mp4Count: 0,
      mp4SizeBytes: 0,
      hasMore: false,
      entries: [],
    };
    for (let page = 1; page <= OWN_NETDISK_DIR_LIST_MAX_PAGES; page += 1) {
      const data = await fetchOwnDirPage(normalizedDir, page);
      if (data.errno !== 0) {
        if (page === 1) attempts.push("list dir=" + normalizedDir + " " + ownDirListFailureMessage(normalizedDir, data));
        debug.errno = data.errno;
        break;
      }
      const list = Array.isArray(data.list) ? data.list : [];
      results.push(...list);
      debug.hasMore = Boolean(data.has_more);
      if (list.length < OWN_NETDISK_DIR_LIST_PAGE_SIZE && !data.has_more) break;
    }
    debug.count = results.length;
    const directFiles = results.filter((entry) => !(entry?.isdir === 1 || entry?.isdir === true));
    debug.fileCount = directFiles.length;
    debug.fileSizeBytes = directFiles.reduce((total, entry) => {
      const size = Number(entry?.size);
      return total + (Number.isFinite(size) && size > 0 ? size : 0);
    }, 0);
    const directMp4Files = directFiles.filter((entry) => itemName(entry).toLowerCase().endsWith(".mp4"));
    debug.mp4Count = directMp4Files.length;
    debug.mp4SizeBytes = directMp4Files.reduce((total, entry) => {
      const size = Number(entry?.size);
      return total + (Number.isFinite(size) && size > 0 ? size : 0);
    }, 0);
    debug.entries = results.slice(0, REMOTE_DIR_ENTRY_SAMPLE_LIMIT).map((entry) => {
      const name = itemName(entry);
      return {
        name,
        path: itemPath(entry) || joinPath(normalizedDir, name),
        isDir: entry?.isdir === 1 || entry?.isdir === true,
        size: Number(entry?.size) > 0 ? Number(entry.size) : undefined,
      };
    });
    return { entries: results, debug };
  };
  const scannedDirs = [];
  const scannedDirPaths = new Set();
  const rootIsOwnership = /工程|权属|资质|版权/.test(String(finalFileName).replace(/\s+/g, ""));
  const rootIsAiProductionProof = /ai制作证明/i.test(String(finalFileName).replace(/\s+/g, ""));
  const queue = [{
    path: normalizeDir(savedPath),
    name: finalFileName,
    fsId: itemFsId(ownRoot),
    depth: 0,
    ownershipScope: rootIsOwnership,
    aiProductionProofScope: rootIsAiProductionProof,
  }];
  const allEntriesByPath = new Map();
  const ownershipFiles = new Map();
  const ownershipAllFiles = new Map();
  const ownershipRoots = new Map();
  const namedPosterFiles = new Map();
  const directoryPosterFiles = new Map();
  const aiProductionProofFiles = new Map();
  const aiProductionProofRoots = new Map();
  if (rootIsOwnership) ownershipRoots.set(normalizeDir(savedPath), itemFsId(ownRoot));
  if (rootIsAiProductionProof) aiProductionProofRoots.set(normalizeDir(savedPath), itemFsId(ownRoot));
  const candidateDirs = [];

  while (queue.length > 0 && scannedDirs.length < REMOTE_VIDEO_SCAN_MAX_DIRS) {
    const current = queue.shift();
    if (!current || scannedDirPaths.has(current.path)) continue;
    scannedDirPaths.add(current.path);

    const listResult = await listDir(current.path);
    listResult.debug.name = current.name || listResult.debug.name;
    listResult.debug.fsId = String(current.fsId || "");
    scannedDirs.push(listResult.debug);
    const entries = listResult.entries;
    const directImages = entries
      .filter((entry) => !(entry?.isdir === 1 || entry?.isdir === true) && /\.(?:png|jpe?g|bmp|webp)$/i.test(itemName(entry)))
      .sort((left, right) => itemName(left).localeCompare(itemName(right), "zh-CN", { numeric: true }));
    const namedPosterImages = directImages.filter((entry) => /封面|海报/.test(itemName(entry)));
    const selectedPosterImages = namedPosterImages.length > 0
      ? namedPosterImages
      : /封面|海报/.test(String(current.name || "")) && directImages[0]
        ? [directImages[0]]
        : [];
    const selectedPosterPaths = new Set(selectedPosterImages.map((entry) => itemPath(entry) || joinPath(current.path, itemName(entry))));
    const namedPosterPaths = new Set(namedPosterImages.map((entry) => itemPath(entry) || joinPath(current.path, itemName(entry))));
    const directEntriesByPath = new Map();
    for (const entry of entries) {
      const name = itemName(entry);
      const entryPath = itemPath(entry) || joinPath(current.path, name);
      if (entry?.isdir === 1 || entry?.isdir === true) {
        if (current.depth < REMOTE_VIDEO_SCAN_MAX_DEPTH) {
          const entersOwnershipScope = !current.ownershipScope
            && /工程|权属|资质|版权/.test(String(name).replace(/\s+/g, ""));
          const entersAiProductionProofScope = !current.aiProductionProofScope && /ai制作证明/i.test(String(name).replace(/\s+/g, ""));
          if (entersOwnershipScope) ownershipRoots.set(normalizeDir(entryPath), itemFsId(entry));
          if (entersAiProductionProofScope) aiProductionProofRoots.set(normalizeDir(entryPath), itemFsId(entry));
          queue.push({
            path: normalizeDir(entryPath),
            name,
            fsId: itemFsId(entry),
            depth: current.depth + 1,
            ownershipScope: current.ownershipScope || entersOwnershipScope,
            aiProductionProofScope: current.aiProductionProofScope || entersAiProductionProofScope,
          });
        }
        continue;
      }
      const lowerName = name.toLowerCase();
      if (current.ownershipScope && /\.(?:png|jpe?g|bmp|webp|pdf)$/i.test(lowerName)) {
        ownershipAllFiles.set(entryPath, {
          name,
          path: entryPath,
          fsId: itemFsId(entry),
          size: Number(entry?.size) > 0 ? Number(entry.size) : undefined,
        });
      }
      if (
        /\.(?:png|jpe?g|bmp|webp|pdf)$/i.test(lowerName)
        && (current.aiProductionProofScope || /ai制作证明/i.test(name.replace(/\s+/g, "")))
      ) {
        aiProductionProofFiles.set(entryPath, {
          name,
          path: entryPath,
          fsId: itemFsId(entry),
          size: Number(entry?.size) > 0 ? Number(entry.size) : undefined,
          rootPath: current.path,
          rootFsId: current.fsId,
        });
        if (!aiProductionProofRoots.has(current.path)) {
          aiProductionProofRoots.set(current.path, current.fsId);
        }
      }
      if (/\.(?:png|jpe?g|bmp|webp)$/i.test(lowerName)) {
        if (selectedPosterPaths.has(entryPath)) {
          const posterFile = {
            name,
            path: entryPath,
            fsId: itemFsId(entry),
            size: Number(entry?.size) > 0 ? Number(entry.size) : undefined,
            rootPath: current.path,
            rootFsId: current.fsId,
          };
          (namedPosterPaths.has(entryPath) ? namedPosterFiles : directoryPosterFiles).set(entryPath, posterFile);
        }
        if (current.ownershipScope) {
          const stem = name.replace(/\.[^.]+$/, "");
          const indexMatch = stem.match(/(\d{1,4})\s*$/);
          ownershipFiles.set(entryPath, {
            index: indexMatch ? Number(indexMatch[1]) : undefined,
            name,
            path: entryPath,
            fsId: itemFsId(entry),
            size: Number(entry?.size) > 0 ? Number(entry.size) : undefined,
          });
        }
      }
      if (!lowerName.endsWith(".mp4")) continue;
      const videoFile = {
        name,
        path: entryPath,
        size: Number(entry?.size) > 0 ? Number(entry.size) : undefined,
      };
      directEntriesByPath.set(entryPath, videoFile);
      allEntriesByPath.set(entryPath, videoFile);
    }
    const directVideoFiles = [...directEntriesByPath.values()].sort((left, right) => left.path.localeCompare(right.path));
    candidateDirs.push({
      path: current.path,
      name: current.name || current.path.split("/").filter(Boolean).pop() || current.path,
      fsId: String(current.fsId || ""),
      depth: current.depth,
      mp4Count: directVideoFiles.length,
      mp4SizeBytes: directVideoFiles.reduce((total, file) => total + (file.size ?? 0), 0),
      videoFiles: directVideoFiles,
    });
  }
  const allVideoFiles = [...allEntriesByPath.values()].sort((left, right) => left.path.localeCompare(right.path));
  const selectedVideoDir = candidateDirs
    .sort((left, right) =>
      right.mp4Count - left.mp4Count ||
      right.mp4SizeBytes - left.mp4SizeBytes ||
      left.depth - right.depth ||
      left.path.localeCompare(right.path),
    )[0] || {
      path: normalizeDir(savedPath),
      name: finalFileName,
      fsId: itemFsId(ownRoot),
      mp4Count: 0,
      mp4SizeBytes: 0,
      videoFiles: [],
    };
  const selectedVideoFiles = selectedVideoDir.videoFiles;
  const files = selectedVideoFiles
    .flatMap((file) => {
      const index = matchEpisodeIndex(file.name);
      if (index === undefined) return [];
      return [{
        index,
        name: file.name,
        path: file.path,
        size: file.size,
      }];
    })
    .sort((left, right) => left.index - right.index || left.path.localeCompare(right.path));
  const matchedVideoPaths = new Set(files.map((file) => file.path));
  const unmatchedVideoFiles = selectedVideoFiles.filter((file) => !matchedVideoPaths.has(file.path));
  if (selectedVideoFiles.length > 0 && files.length === 0) {
    console.log(
      "[baidu] 集数匹配诊断：" +
        selectedVideoFiles
          .slice(0, 5)
          .map((file) => file.name + "=>" + String(matchEpisodeIndex(file.name) ?? "未匹配"))
          .join(" | "),
    );
  }
  if (unmatchedVideoFiles.length > 0) {
    console.log(
      "[baidu] 未匹配集数视频：" +
        unmatchedVideoFiles
          .slice(0, 10)
          .map((file) => file.name + "=>" + String(matchEpisodeIndex(file.name) ?? "未匹配"))
          .join(" | ") +
        (unmatchedVideoFiles.length > 10 ? " | ...另" + (unmatchedVideoFiles.length - 10) + "项" : ""),
    );
  }
  const duplicateIndexes = [...new Set(files
    .filter((file, index) => index > 0 && file.index === files[index - 1].index)
    .map((file) => file.index))];

  return {
    fileName: selectedVideoDir.name || finalFileName,
    savedPath: selectedVideoDir.path || savedPath,
    fsId: selectedVideoDir.fsId || itemFsId(ownRoot),
    resourceRootName: finalFileName,
    resourceRootPath: normalizeDir(savedPath),
    resourceRootFsId: itemFsId(ownRoot),
    alreadySaved,
    locateSource,
    shareStructure: shareHasDramaWrapper ? "wrapped" : "flat",
    transferredItemCount: transferredCount,
    remoteVideos: {
      rootPath: selectedVideoDir.path || savedPath,
      files,
      allVideoFiles,
      unmatchedVideoFiles,
      scannedDirs,
      duplicateIndexes,
    },
    remoteOwnership: {
      files: [...ownershipFiles.values()]
        .sort((left, right) => (left.index ?? Number.MAX_SAFE_INTEGER) - (right.index ?? Number.MAX_SAFE_INTEGER) || left.path.localeCompare(right.path)),
      allFiles: [...ownershipAllFiles.values()]
        .sort((left, right) => left.path.localeCompare(right.path, "zh-CN", { numeric: true })),
      roots: [...ownershipRoots.entries()].map(([path, fsId]) => ({ path, fsId })),
      rootPath: [...ownershipRoots.keys()][0] || "",
      rootFsId: [...ownershipRoots.values()][0] || "",
    },
    remotePosters: (() => {
      const sortPosters = (files) => files.sort((left, right) =>
        Number(!left.name.includes("海报")) - Number(!right.name.includes("海报"))
        || left.name.localeCompare(right.name, "zh-CN", { numeric: true })
        || left.path.localeCompare(right.path));
      const selected = sortPosters([...namedPosterFiles.values()])[0]
        || sortPosters([...directoryPosterFiles.values()])[0];
      return selected
        ? { files: [selected], roots: [{ path: selected.rootPath, fsId: selected.rootFsId }] }
        : { files: [], roots: [] };
    })(),
    remoteAiProductionProofs: {
      files: [...aiProductionProofFiles.values()]
        .sort((left, right) => left.path.localeCompare(right.path)),
      roots: [...aiProductionProofRoots.entries()].map(([path, fsId]) => ({ path, fsId })),
    },
  };
})()
`,
      10 * 60_000,
    );

      if (!result.savedPath) throw new Error("没有拿到保存后的网盘路径。");
      return result;
    } finally {
      stopConsoleForwarding();
    }
  });
}

async function findClientPage(port: number) {
  const targets = await getTargets(port);
  const coreTargets = uniqueTargets(
    targets.filter(
      (item) =>
        item.webSocketDebuggerUrl &&
        item.url.includes("core.asar") &&
        !item.url.includes("#/bubble_menu") &&
        !item.url.includes("#/sestonMenu"),
    ),
  );
  const candidates = uniqueTargets([
    ...coreTargets.filter((target) => target.url.includes("#/searchNew")),
    ...coreTargets.filter((target) => target.url.includes("#/downloading")),
    ...coreTargets.filter((target) => target.url.includes("#/?category=all")),
    ...coreTargets.filter(
      (target) => !target.url.includes("#/workspace") && !target.url.includes("#/seston"),
    ),
    ...coreTargets,
  ]);
  const summaries: string[] = [];

  for (const candidate of candidates) {
    const state = await withPage(candidate, (page) =>
      page
        .evaluate<{
          href: string;
          body: string;
          input?: { id: string; placeholder: string };
        }>(
          `
(() => {
  const input = document.querySelector("#tags-input-ipt,input[placeholder*='网盘文件'],input[placeholder*='网盘'],input[placeholder*='搜']");
  return {
    href: location.href,
    body: document.body ? document.body.innerText.replace(/\\s+/g, " ").trim().slice(0, 120) : "",
    input: input instanceof HTMLInputElement
      ? { id: input.id || "", placeholder: input.getAttribute("placeholder") || "" }
      : undefined,
  };
})()
`,
          5000,
        )
        .catch(() => undefined),
    );
    summaries.push(
      `${candidate.url} input=${state?.input ? `${state.input.id || "-"}:${state.input.placeholder}` : "none"} text=${compactText(state?.body ?? "", 80)}`,
    );

    const input = state?.input;
    if (!input) continue;
    if (
      input.id === "tags-input-ipt" ||
      input.placeholder.includes("网盘文件") ||
      input.placeholder.includes("网盘")
    ) {
      return {
        ...candidate,
        url: state.href || candidate.url,
      };
    }
  }

  throw new Error(
    `没有找到带客户端搜索框的百度网盘页面。当前页面：${summaries.join(" | ") || "无"}`,
  );
}

async function downloadSavedFolderFromClientSearch(port: number, targetName: string) {
  const target = await findClientPage(port);
  await withPage(target, async (page) => {
    log(`客户端搜索并下载目录：${targetName}`);
    const result = await page.evaluate<{
      clicked: boolean;
      href: string;
      text: string;
      candidates: string[];
    }>(
      `
(async () => {
  const wanted = ${JSON.stringify(targetName)};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const bodyText = () => (document.body ? document.body.innerText : "");
  const normalizedText = (item) =>
    String(item?.innerText || item?.textContent || item?.getAttribute?.("title") || "")
      .replace(/\\s+/g, " ")
      .trim();
  const isVisible = (item) => {
    if (!(item instanceof HTMLElement)) return false;
    const rect = item.getBoundingClientRect();
    const style = getComputedStyle(item);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const isIgnoredClientContainer = (item) =>
    Boolean(item.closest(
      ".link-share,.search-history-wrap,.recommend-card-transition-wrap,.all-file-recommend-area,.u-popover,.u-popper",
    ));
  const candidateNames = (row) => {
    if (!(row instanceof HTMLElement)) return [];
    const names = [];
    const push = (value) => {
      const name = String(value || "").replace(/\\s+/g, " ").trim();
      if (!name) return;
      if (/^(下载|分享|刪除|删除|重命名|更多)$/.test(name)) return;
      if (!names.includes(name)) names.push(name);
    };
    const filename = row.querySelector(".filename");
    if (filename instanceof HTMLElement) {
      push(filename.getAttribute("title"));
      push(filename.innerText || filename.textContent);
    }
    for (const item of row.querySelectorAll("[title]")) {
      push(item.getAttribute("title"));
    }
    return names;
  };
  const isFolderRow = (row, text) =>
    text.includes("文件夹") ||
    Boolean(row.querySelector("[data-category='6'],.folder,.dir,[class*=folder],[class*=Folder]"));
  const clickFoldedFolderMore = () => {
    const button = [...document.querySelectorAll("button,a,div,span")]
      .find((item) => {
        if (!(item instanceof HTMLElement) || !isVisible(item) || isIgnoredClientContainer(item)) return false;
        const text = normalizedText(item);
        return text === "查看更多" && Boolean(item.closest(".search-file,.main-content,#app"));
      });
    if (!(button instanceof HTMLElement)) return false;
    return fireClick(button);
  };
  const fireClick = (item) => {
    if (!(item instanceof HTMLElement)) return false;
    item.scrollIntoView({ block: "center", inline: "center" });
    const rect = item.getBoundingClientRect();
    for (const type of ["pointerover", "mouseover", "pointermove", "mousemove", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      item.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.x + rect.width / 2,
        clientY: rect.y + rect.height / 2,
      }));
    }
    return true;
  };
  const findSearchInput = () =>
    document.querySelector("#tags-input-ipt,input[placeholder*='网盘'],input[placeholder*='搜']");

  let input = findSearchInput();
  if (!(input instanceof HTMLInputElement)) {
    location.hash = "/?category=all&path=%2F";
    await sleep(1500);
    input = findSearchInput();
  }
  if (!(input instanceof HTMLInputElement)) {
    return { clicked: false, href: location.href, text: bodyText() };
  }

  input.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, wanted);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
  }));
  input.dispatchEvent(new KeyboardEvent("keyup", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
  }));

  let row;
  const started = Date.now();
  let candidates = [];
  let expandedFolderResults = false;
  while (Date.now() - started < 25000) {
    const rows = [...document.querySelectorAll(".fileItemWrapSearch,.itemWrap,tr.u-table__row,dd")];
    candidates = rows
      .filter((item) => item instanceof HTMLElement && isVisible(item) && !isIgnoredClientContainer(item))
      .flatMap((item) => candidateNames(item))
      .filter((name, index, list) => list.indexOf(name) === index)
      .slice(0, 12);
    row = rows.find((item) => {
      if (!(item instanceof HTMLElement) || !isVisible(item) || isIgnoredClientContainer(item)) return false;
      const text = normalizedText(item);
      return candidateNames(item).includes(wanted) && isFolderRow(item, text);
    });
    if (row instanceof HTMLElement) break;
    if (!expandedFolderResults && clickFoldedFolderMore()) {
      expandedFolderResults = true;
      await sleep(1200);
      continue;
    }
    await sleep(500);
  }

  if (!(row instanceof HTMLElement)) {
    return { clicked: false, href: location.href, text: bodyText(), candidates };
  }

  fireClick(row);
  await sleep(250);

  let button =
    row.querySelector(".download,[title='下载']") ||
    [...row.querySelectorAll("div,span,a,button")].find(
      (item) =>
        item instanceof HTMLElement &&
        isVisible(item) &&
        !isIgnoredClientContainer(item) &&
        (normalizedText(item) === "下载" || item.getAttribute("title") === "下载"),
    );
  if (!(button instanceof HTMLElement)) {
    fireClick(row);
    await sleep(500);
    button =
      row.querySelector(".download,[title='下载']") ||
      [...row.querySelectorAll("div,span,a,button")].find(
        (item) =>
          item instanceof HTMLElement &&
          isVisible(item) &&
          !isIgnoredClientContainer(item) &&
          (normalizedText(item) === "下载" || item.getAttribute("title") === "下载"),
      );
  }

  if (!(button instanceof HTMLElement)) {
    const checkbox = row.querySelector(".checkbox,.file-select,.checkbox-content,[class*=checkbox]");
    if (checkbox instanceof HTMLElement) {
      fireClick(checkbox);
      await sleep(500);
    }
    button = [...document.querySelectorAll(".downloadBtn,.download,[title='下载'],button,a,div,span")]
      .find((item) => {
        if (!(item instanceof HTMLElement) || !isVisible(item) || isIgnoredClientContainer(item)) return false;
        const text = normalizedText(item);
        const title = String(item.getAttribute("title") || "");
        const className = String(item.className || "");
        if (/disabled|is-disabled/.test(className)) return false;
        return className.includes("downloadBtn") || className === "download" || text === "下载" || title === "下载";
      });
  }

  if (!(button instanceof HTMLElement)) {
    return { clicked: false, href: location.href, text: bodyText(), candidates: candidateNames(row) };
  }

  fireClick(button);
  await sleep(500);
  return { clicked: true, href: location.href, text: bodyText(), candidates: candidateNames(row) };
})()
`,
      30000,
    );

    if (!result.clicked) {
      throw new Error(
        `没有在客户端搜索结果中精确命中并下载目录：${targetName}；候选=${result.candidates.join(" | ") || "无"}；url=${result.href}；页面=${compactText(result.text)}`,
      );
    }
  });
}

async function confirmDownloadSetting(port: number, downloadDir?: string) {
  const settingTarget = await waitForTarget(
    port,
    (target) => target.url.includes("#/downloadingSetting"),
    20000,
  );

  return withPage(settingTarget, async (page) => {
    let rect: Rect | undefined;
    let downloadRoot: string | undefined;
    let downloadDirApplied = false;

    for (let attempt = 0; attempt < DOWNLOAD_SETTING_MAX_ATTEMPTS; attempt++) {
      const state = await page.evaluate<{
        rect?: Rect;
        text: string;
        downloadDirApplied: boolean;
      }>(`
(async () => {
  const desiredDownloadDir = ${JSON.stringify(downloadDir ?? "")};
  let downloadDirApplied = false;
  const setValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  if (desiredDownloadDir) {
    const inputs = [...document.querySelectorAll("input")];
    const pathInput = inputs.find((input) => {
      const value = String(input.value || input.getAttribute("value") || "");
      const placeholder = String(input.getAttribute("placeholder") || "");
      const aria = String(input.getAttribute("aria-label") || "");
      const containerText = String(input.closest("div,section,form")?.textContent || "");
      return /[a-zA-Z]:\\\\/.test(value) ||
        value.includes("\\\\") ||
        /下载|路径|存储|保存|目录|download|path/i.test(placeholder + aria + containerText);
    });

    if (pathInput instanceof HTMLInputElement) {
      pathInput.focus();
      setValue(pathInput, desiredDownloadDir);
      downloadDirApplied = pathInput.value === desiredDownloadDir;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  const button = document.querySelector(".down-btn");
  const rect = button instanceof HTMLElement ? button.getBoundingClientRect() : undefined;
  return {
    text: document.body ? document.body.innerText : "",
    rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined,
    downloadDirApplied,
  };
})()
`);
      downloadRoot = parseDownloadRoot(state.text) ?? downloadRoot;
      downloadDirApplied = state.downloadDirApplied || downloadDirApplied;
      rect = state.rect ?? rect;
      if (rect) break;
      await sleep(100);
    }

    if (!rect) throw new Error("没有找到确认下载按钮。");
    const resolvedDownloadRoot = downloadDirApplied ? downloadDir : (downloadRoot ?? downloadDir);
    log(resolvedDownloadRoot ? `确认下载路径：${resolvedDownloadRoot}` : "确认下载路径");
    await page.clickPoint(rect.x + rect.width / 2, rect.y + rect.height / 2, true);
    return resolvedDownloadRoot;
  });
}

function parseDownloadRoot(text: string) {
  const line = text.split(/\r?\n/).find((item) => item.includes("下载到"));
  return line?.replace(/^.*下载到[:：]\s*/, "").trim();
}

type SavedDownloadTask = {
  targetName: string;
  savedPath: string;
  fsId: number | string;
  downloadRoot?: string;
};

function findUsableCoreTarget(targets: CdpTarget[]) {
  return uniqueTargets(
    targets.filter(
      (target) =>
        target.webSocketDebuggerUrl &&
        target.url.includes("core.asar") &&
        !target.url.includes("#/bubble_menu") &&
        !target.url.includes("#/sestonMenu") &&
        !target.url.includes("#/workspace"),
    ),
  )[0];
}

async function openClientTransfers(port: number) {
  const target = findUsableCoreTarget(await getTargets(port));
  if (!target) return;

  await withPage(target, (page) =>
    page
      .evaluate(`(() => { location.hash = "/downloading"; return location.href; })()`, 5000)
      .catch(() => undefined),
  );
}

async function getNativeDownloadTask(port: number, targetName: string) {
  const target = findUsableCoreTarget(await getTargets(port));
  if (!target) return undefined;

  return withPage(target, (page) =>
    page
      .evaluate<{
        matched?: {
          id?: string;
          name?: string;
          serverPath?: string;
          localPath?: string;
          status?: string;
          size?: string;
          finishSize?: string;
          rate?: string;
        };
        tasks: string[];
      }>(
        `
(async () => {
  const wanted = ${JSON.stringify(targetName)};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalized = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  const nameFromPath = (value) => String(value || "").split(/[\\\\/]/).filter(Boolean).pop() || "";
  const isWanted = (task) => {
    const name = normalized(task?.name || nameFromPath(task?.server_path) || nameFromPath(task?.local_path));
    return name === wanted || nameFromPath(task?.server_path) === wanted || nameFromPath(task?.local_path) === wanted;
  };

  let payload;
  try {
    const app = require("@electron/remote").app;
    app.$downloader.getDownloadTasks((errorNo, flag, items, count, cid) => {
      payload = { errorNo, flag, items, count, cid };
    }, 0, 1000, "0");
  } catch {
    return { tasks: [] };
  }

  const started = Date.now();
  while (!payload && Date.now() - started < 1500) {
    await sleep(100);
  }

  const list = Array.isArray(payload?.items?.tasks) ? payload.items.tasks : [];
  const tasks = list.map((task) =>
    [
      task?.name,
      task?.status,
      task?.finish_size + "/" + task?.size,
      task?.rate,
      task?.server_path,
      task?.local_path,
    ].map(normalized).filter(Boolean).join(" "),
  );
  const matched = list.find(isWanted);
  return {
    matched: matched
      ? {
          id: String(matched.id || ""),
          name: String(matched.name || ""),
          serverPath: String(matched.server_path || ""),
          localPath: String(matched.local_path || ""),
          status: String(matched.status || ""),
          size: String(matched.size || ""),
          finishSize: String(matched.finish_size || ""),
          rate: String(matched.rate || ""),
        }
      : undefined,
    tasks,
  };
})()
`,
        6000,
      )
      .catch(() => undefined),
  );
}

function parseTaskNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export async function getBaiduNetdiskDownloadTaskStatus(options: {
  port?: number;
  targetName: string;
}): Promise<BaiduNetdiskDownloadTaskStatus> {
  const port = options.port ?? 9337;
  const targetName = options.targetName.trim();

  if (!targetName) {
    throw new Error("targetName is required.");
  }

  await ensureBaiduCdpPort(port);
  const nativeTask = await getNativeDownloadTask(port, targetName);
  const matched = nativeTask?.matched;
  const size = parseTaskNumber(matched?.size);
  const finishSize = parseTaskNumber(matched?.finishSize);
  const status = matched?.status;
  const completedBySize = size !== undefined && size > 0 && finishSize === size;
  const completedByStatus = Boolean(
    status && /完成|success|finished|complete|done|已下载/i.test(status),
  );

  return {
    found: Boolean(matched),
    name: matched?.name || targetName,
    localPath: matched?.localPath,
    status,
    size,
    finishSize,
    rate: matched?.rate,
    completed: Boolean(matched && (completedBySize || completedByStatus)),
    tasks: nativeTask?.tasks ?? [],
  };
}

export async function controlBaiduNetdiskDownloadTask(options: {
  port?: number;
  targetName: string;
  action: "pause" | "resume" | "delete";
  expectedDownloadRoot?: string;
}) {
  const target = findUsableCoreTarget(await getTargets(options.port ?? 9337));
  if (!target) throw new Error("百度网盘 CDP 页面不可用。");
  return withPage(target, (page) => page.evaluate(`(async()=>{const app=require("@electron/remote").app;const wanted=${JSON.stringify(options.targetName)};const action=${JSON.stringify(options.action)};const expectedRoot=${JSON.stringify(options.expectedDownloadRoot ?? "")};const normalizePath=v=>String(v||"").replace(/\\//g,"\\\\").replace(/\\\\+$/g,"").toLowerCase();const root=normalizePath(expectedRoot);const d=app.$downloader;let payload;d.getDownloadTasks((e,f,i)=>payload=i,0,1000,"0");for(let n=0;!payload&&n<20;n++)await new Promise(r=>setTimeout(r,100));const list=Array.isArray(payload?.tasks)?payload.tasks:[];const t=list.find(x=>{const name=String(x?.name||x?.server_path||"");if(!name.includes(wanted))return false;if(!root)return true;const localPath=normalizePath(x?.local_path);return localPath===root||localPath.startsWith(root+"\\\\");});if(!t)throw new Error("未找到匹配下载目录的下载任务");const id=t.id;const names=action==="pause"?["pauseTask","pauseDownloadTask","pause"]:action==="resume"?["resumeTask","resumeDownloadTask","startTask"]:["deleteTask","removeTask","deleteDownloadTask"];const fn=names.find(k=>typeof d[k]==="function");if(!fn)throw new Error("百度网盘当前版本不支持该操作");await Promise.resolve(d[fn](id));return true;})()`));
}

async function submitNativeDownloadTask(port: number, task: SavedDownloadTask) {
  if (!task.downloadRoot) return false;

  const target = findUsableCoreTarget(await getTargets(port));
  if (!target) return false;

  const result = await withPage(target, (page) =>
    page
      .evaluate<{ ok: boolean; ret?: number | string; error?: string }>(
        `
(() => {
  try {
    const app = require("@electron/remote").app;
    const file = {
      md5: "",
      size: 0,
      server_path: ${JSON.stringify(task.savedPath)},
      path: ${JSON.stringify(task.savedPath)},
      is_dir: 1,
      fs_id: ${JSON.stringify(task.fsId)},
      local_path: ${JSON.stringify(task.downloadRoot)},
    };
    const ret = app.$downloader.addDownloadTask([file], "self", true, "0");
    return { ok: true, ret };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
})()
`,
        10000,
      )
      .catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })),
  );

  if (!result.ok) {
    log(`客户端内部下载任务提交失败：${result.error || "unknown"}`);
    return false;
  }

  log(`客户端内部下载任务已提交：${task.targetName}`);
  return true;
}

async function waitForDownloadSubmitted(port: number, task?: SavedDownloadTask) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    const targets = await getTargets(port);
    if (!targets.some((target) => target.url.includes("#/downloadingSetting"))) {
      if (!task?.targetName) {
        log("下载任务已提交");
        return;
      }

      log(`下载设置窗口已关闭，等待进入传输列表：${task.targetName}`);
      await openClientTransfers(port);
      const verifyStarted = Date.now();
      let lastLog = 0;
      let nativeSubmitted = false;
      while (Date.now() - verifyStarted < 90000) {
        if (await isPresentInClientTransfers(port, task.targetName)) {
          log("下载任务已提交");
          return;
        }
        if (!nativeSubmitted && Date.now() - verifyStarted > 5000) {
          nativeSubmitted = await submitNativeDownloadTask(port, task);
          if (nativeSubmitted) await openClientTransfers(port);
        }
        if (Date.now() - lastLog > 10000) {
          log(`仍在等待客户端创建传输任务：${task.targetName}`);
          lastLog = Date.now();
        }
        await sleep(500);
      }

      throw new Error(`下载设置窗口已关闭，但 ${task.targetName} 没有进入客户端传输列表。`);
    }
    await sleep(500);
  }

  throw new Error("已点击确认下载，但下载设置窗口没有关闭。");
}

async function isPresentInClientTransfers(port: number, targetName: string) {
  const nativeTask = await getNativeDownloadTask(port, targetName);
  if (nativeTask?.matched) return true;

  const targets = await getTargets(port);
  const transferTargets = targets.filter(
    (target) =>
      target.webSocketDebuggerUrl &&
      target.url.includes("core.asar") &&
      target.url.includes("#/downloading"),
  );

  for (const transferTarget of transferTargets) {
    const text = await withPage(transferTarget, (page) =>
      page.evaluate<boolean>(
        `
(() => {
  const wanted = ${JSON.stringify(targetName)};
  if (!location.href.includes("#/downloading")) return false;

  const bodyText = () => (document.body ? document.body.innerText : "");
  const normalizedText = (item) =>
    String(item?.innerText || item?.textContent || item?.getAttribute?.("title") || "")
      .replace(/\\s+/g, " ")
      .trim();
  const isVisible = (item) => {
    if (!(item instanceof HTMLElement)) return false;
    const rect = item.getBoundingClientRect();
    const style = getComputedStyle(item);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const transferSignal =
    /已暂停|正在下载|等待中|暂停|排队|\\d+(?:\\.\\d+)?\\s*(?:B|KB|MB|GB)\\s*\\/\\s*\\d+(?:\\.\\d+)?\\s*(?:B|KB|MB|GB)|\\d+%|(?:B|KB|MB|GB)\\/S/i;

  const pageText = bodyText();
  if (!/下载中|全部暂停|全部开始/.test(pageText)) return false;
  if (/暂无正在下载的文件/.test(pageText) && !pageText.includes("文件 已全部加载，共")) return false;

  const transferStart = pageText.indexOf("文件 已全部加载，共");
  const transferText = transferStart >= 0 ? pageText.slice(transferStart) : "";
  if (!transferText) return false;

  const rows = [
    ...document.querySelectorAll(".main-content .content .itemWrap,.main-content .content tr.u-table__row,.main-content .content dd,[class*=transfer-list] .itemWrap,[class*=transfer] tr.u-table__row"),
  ];
  if (
    rows.some((row) => {
      if (!(row instanceof HTMLElement) || !isVisible(row)) return false;
      const filename = row.querySelector(".filename,[title]");
      const exactName =
        filename instanceof HTMLElement
          ? String(filename.getAttribute("title") || normalizedText(filename)).trim()
          : "";
      const text = normalizedText(row);
      return exactName === wanted && transferSignal.test(text);
    })
  ) {
    return true;
  }

  const lines = transferText
    .split(/\\r?\\n/)
    .map((line) => line.replace(/\\s+/g, " ").trim())
    .filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== wanted) continue;
    const windowText = lines.slice(index, index + 6).join(" ");
    if (transferSignal.test(windowText)) return true;
  }

  return false;
})()
`,
        10000,
      ),
    ).catch(() => false);
    if (text) return true;
  }

  return false;
}

async function countLocalOwnershipImages(root: string) {
  let count = 0;
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) queue.push(path.join(current, entry.name));
      else if (entry.isFile() && /\.(?:png|jpe?g|bmp|webp)$/i.test(entry.name)) count += 1;
    }
  }
  return count;
}

async function countLocalPosterImages(root: string) {
  let count = 0;
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    const images = entries
      .filter((entry) => entry.isFile() && /\.(?:png|jpe?g|bmp|webp)$/i.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN", { numeric: true }));
    const named = images.filter((entry) => /封面|海报/.test(entry.name));
    count += named.length > 0 ? named.length : /封面|海报/.test(path.basename(current)) && images.length > 0 ? 1 : 0;
    for (const entry of entries) if (entry.isDirectory()) queue.push(path.join(current, entry.name));
  }
  return count;
}

export function inspectContiguousEpisodeIndexes(
  indexes: number[],
  duplicateIndexes: number[] = [],
) {
  const normalizedIndexes = [...new Set(indexes)]
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((left, right) => left - right);
  const episodeCount = normalizedIndexes[normalizedIndexes.length - 1] ?? 0;
  const expectedIndexes = Array.from({ length: episodeCount }, (_, index) => index + 1);
  const missingIndexes = expectedIndexes.filter((index) => !normalizedIndexes.includes(index));
  const normalizedDuplicateIndexes = [...new Set(duplicateIndexes)]
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((left, right) => left - right);
  return {
    episodeCount,
    indexes: normalizedIndexes,
    missingIndexes,
    duplicateIndexes: normalizedDuplicateIndexes,
    valid:
      episodeCount > 0
      && missingIndexes.length === 0
      && normalizedDuplicateIndexes.length === 0,
  };
}

async function submitSavedDownload(
  port: number,
  shareTarget: CdpTarget,
  share: ShareInfo,
  downloadDir?: string,
  expectedEpisodeCount?: number,
  expectedOwnershipCounts?: BaiduNetdiskShareDownloadOptions["expectedOwnershipCounts"],
  expectedOwnershipFiles?: number,
  expectedPosterImages?: number,
  expectedAiProductionProofFiles?: number,
  downloadEpisodeVideos = true,
  inferEpisodeCount = false,
  downloadAssetMaterials = true,
  saveOptions: SaveShareOptions = {},
) {
  const saved = await saveShareToOwnNetdisk(shareTarget, share, saveOptions);
  log(
    saved.shareStructure === "wrapped"
      ? "分享结构：最外层为剧名目录，直接转存或复用该目录"
      : "分享结构：最外层为素材目录，使用剧名目录归档并增量转存",
  );
  log(
    saved.alreadySaved
      ? `网盘中已存在目录：${saved.resourceRootPath} (${saved.locateSource})`
      : saved.locateSource.startsWith("existing")
        ? `已复用并补齐网盘目录：${saved.resourceRootPath}，新增=${saved.transferredItemCount} (${saved.locateSource})`
        : `已保存到网盘：${saved.resourceRootPath}，新增=${saved.transferredItemCount} (${saved.locateSource})`,
  );

  const videoTargetName = saved.fileName || share.name;
  const targetName = downloadEpisodeVideos
    ? videoTargetName
    : saved.resourceRootName || share.name;
  log(
    downloadEpisodeVideos
      ? `选中视频目录：${saved.savedPath}，名称=${videoTargetName}`
      : `素材-only 模式：跳过视频目录下载，资源目录=${saved.resourceRootPath}`,
  );
  const remoteVideos = saved.remoteVideos;
  const remoteOwnership = saved.remoteOwnership;
  const remotePosters = saved.remotePosters;
  const remoteAiProductionProofs = saved.remoteAiProductionProofs;
  const remoteIndexes = [...new Set(remoteVideos.files.map((file) => file.index))].sort(
    (left, right) => left - right,
  );
  const formatNumberRanges = (values: number[]) => {
    const sorted = [...new Set(values)].sort((left, right) => left - right);
    if (sorted.length <= 0) return "无";

    const ranges: string[] = [];
    let start = sorted[0];
    let previous = sorted[0];
    for (const value of sorted.slice(1)) {
      if (value === previous + 1) {
        previous = value;
        continue;
      }
      ranges.push(start === previous ? String(start) : `${start}-${previous}`);
      start = value;
      previous = value;
    }
    ranges.push(start === previous ? String(start) : `${start}-${previous}`);
    return ranges.join(", ");
  };
  const formatNameSample = (names: string[], limit = 5) => {
    if (names.length <= 0) return "无";
    const sample = names.slice(0, limit).join(" | ");
    const suffix = names.length > limit ? ` | ...另${names.length - limit}项` : "";
    return sample + suffix;
  };
  log(
    `网盘目录视频清单：匹配=${remoteVideos.files.length}个，集数=${formatNumberRanges(remoteIndexes)}，` +
      `全部mp4=${remoteVideos.allVideoFiles.length}个`,
  );
  logRemoteVideoScanDetails(remoteVideos);
  if (remoteVideos.unmatchedVideoFiles?.length) {
    log(
      `网盘未匹配集数视频：` +
        remoteVideos.unmatchedVideoFiles
          .slice(0, 10)
          .map((file) => file.name)
          .join(" | ") +
        (remoteVideos.unmatchedVideoFiles.length > 10
          ? ` | ...另${remoteVideos.unmatchedVideoFiles.length - 10}项`
          : ""),
    );
  }
  if (remoteVideos.files.length > 0) {
    log(
      `网盘匹配摘要：数量=${remoteVideos.files.length}，集数=${formatNumberRanges(remoteIndexes)}，` +
        `文件名=${formatNameSample(remoteVideos.files.map((file) => `${file.index}:${file.name}`))}`,
    );
  }
  let inferredEpisodeCount: number | undefined;
  if (inferEpisodeCount) {
    const inspection = inspectContiguousEpisodeIndexes(
      remoteIndexes,
      remoteVideos.duplicateIndexes,
    );
    if (inspection.episodeCount <= 0) {
      throw new RemoteMaterialValidationError({
        material: "episode",
        expected: 1,
        actual: 0,
        message:
          `百度网盘没有识别到可上传的剧集视频：${targetName}。` +
          `请使用“第1集.mp4”“剧名-第1集.mp4”或“1.mp4”等包含集数的文件名。`,
      });
    }
    inferredEpisodeCount = inspection.episodeCount;
    const missingIndexes = inspection.missingIndexes;
    remoteVideos.missingIndexes = missingIndexes;
    if (!inspection.valid) {
      if (remoteVideos.duplicateIndexes.length > 0 && !saveOptions.isolatedRoot) {
        log(
          `检测到复用网盘目录存在重复剧集：${formatNumberRanges(remoteVideos.duplicateIndexes)}，` +
            "改用干净的分享专属中转目录重新转存。",
        );
        return submitSavedDownload(
          port,
          shareTarget,
          share,
          downloadDir,
          expectedEpisodeCount,
          expectedOwnershipCounts,
          expectedOwnershipFiles,
          expectedPosterImages,
          expectedAiProductionProofFiles,
          downloadEpisodeVideos,
          inferEpisodeCount,
          downloadAssetMaterials,
          { isolatedRoot: true, isolatedRootUnique: true },
        );
      }
      const problemParts = [
        missingIndexes.length > 0 ? `缺失=${formatNumberRanges(missingIndexes)}` : "",
        remoteVideos.duplicateIndexes.length > 0
          ? `重复=${formatNumberRanges(remoteVideos.duplicateIndexes)}`
          : "",
      ].filter(Boolean);
      throw new RemoteMaterialValidationError({
        material: "episode",
        expected: inferredEpisodeCount,
        actual: remoteVideos.files.length,
        message: `百度网盘剧集不连续：${targetName}。` +
          `系统识别为1-${inferredEpisodeCount}共${inferredEpisodeCount}集，` +
          `实际${formatNumberRanges(remoteIndexes)}共${remoteVideos.files.length}个文件。` +
          `问题：${problemParts.join("；")}。`,
      });
    }
    log(`已自动识别总集数：${inferredEpisodeCount}集，1-${inferredEpisodeCount}连续完整。`);
  } else if (expectedEpisodeCount !== undefined) {
    const expectedCount = Number(expectedEpisodeCount);
    const expectedIndexes =
      Number.isInteger(expectedCount) && expectedCount > 0
        ? Array.from({ length: expectedCount }, (_, index) => index + 1)
        : [];
    const missingIndexes = expectedIndexes.filter((index) => !remoteIndexes.includes(index));
    const unexpectedIndexes = remoteIndexes.filter((index) => !expectedIndexes.includes(index));
    remoteVideos.missingIndexes = missingIndexes;
    if (
      expectedIndexes.length <= 0 ||
      remoteIndexes.length !== expectedIndexes.length ||
      missingIndexes.length > 0 ||
      remoteVideos.duplicateIndexes.length > 0
    ) {
      if (remoteVideos.duplicateIndexes.length > 0 && !saveOptions.isolatedRoot) {
        log(
          `检测到复用网盘目录存在重复剧集：${formatNumberRanges(remoteVideos.duplicateIndexes)}，` +
            "改用干净的分享专属中转目录重新转存。",
        );
        return submitSavedDownload(
          port,
          shareTarget,
          share,
          downloadDir,
          expectedEpisodeCount,
          expectedOwnershipCounts,
          expectedOwnershipFiles,
          expectedPosterImages,
          expectedAiProductionProofFiles,
          downloadEpisodeVideos,
          inferEpisodeCount,
          downloadAssetMaterials,
          { isolatedRoot: true, isolatedRootUnique: true },
        );
      }
      const problemParts = [
        missingIndexes.length > 0 ? `缺失=${formatNumberRanges(missingIndexes)}` : "",
        unexpectedIndexes.length > 0 ? `超出=${formatNumberRanges(unexpectedIndexes)}` : "",
        remoteVideos.duplicateIndexes.length > 0
          ? `重复=${formatNumberRanges(remoteVideos.duplicateIndexes)}`
          : "",
      ].filter(Boolean);
      throw new RemoteMaterialValidationError({
        material: "episode",
        expected: expectedIndexes.length,
        actual: remoteVideos.files.length,
        message: `百度网盘剧集视频数量不正确：${targetName}。` +
          `期望1-${expectedEpisodeCount}共${expectedIndexes.length}集，` +
          `实际${formatNumberRanges(remoteIndexes)}共${remoteVideos.files.length}集。` +
          (problemParts.length > 0 ? `问题：${problemParts.join("；")}。` : ""),
      });
    }
  }
  const requiredOwnershipImages = Math.max(0, expectedOwnershipCounts?.minimumImages ?? 0);
  log(`网盘权属材料清单：图片=${remoteOwnership.files.length}/${requiredOwnershipImages}`);
  if (remoteOwnership.files.length < requiredOwnershipImages) {
    throw new RemoteMaterialValidationError({
      material: "ownership-images",
      expected: requiredOwnershipImages,
      actual: remoteOwnership.files.length,
      message: `百度网盘权属材料数量不足。` +
        `至少需要${requiredOwnershipImages}张图片，实际找到${remoteOwnership.files.length}张。` +
        `请在分享资源中添加“权属”或“工程”目录及对应图片。`,
    });
  }
  const requiredOwnershipFiles = Math.max(0, expectedOwnershipFiles ?? 0);
  log(`网盘权属材料清单：文件=${remoteOwnership.allFiles.length}/${requiredOwnershipFiles}`);
  if (remoteOwnership.allFiles.length < requiredOwnershipFiles) {
    throw new RemoteMaterialValidationError({
      material: "ownership-files",
      expected: requiredOwnershipFiles,
      actual: remoteOwnership.allFiles.length,
      message: `百度网盘权属文件数量不足。` +
        `至少需要${requiredOwnershipFiles}个 JPG、PNG 或 PDF，实际找到${remoteOwnership.allFiles.length}个。` +
        `请在分享资源中添加独立的“权属”“工程”“资质”或“版权”目录。`,
    });
  }
  const requiredPosterImages = Math.max(0, expectedPosterImages ?? 0);
  log(`网盘海报封面清单：图片=${remotePosters.files.length}/${requiredPosterImages}`);
  if (remotePosters.files.length < requiredPosterImages) {
    throw new RemoteMaterialValidationError({
      material: "poster",
      expected: requiredPosterImages,
      actual: remotePosters.files.length,
      message: `百度网盘海报封面数量不足。` +
        `至少需要${requiredPosterImages}张图片，实际找到${remotePosters.files.length}张。` +
        `请在分享资源中添加“海报”或“封面”目录及对应图片。`,
    });
  }
  const requiredAiProductionProofFiles = Math.max(0, expectedAiProductionProofFiles ?? 0);
  log(`网盘AI制作证明清单：文件=${remoteAiProductionProofs.files.length}/${requiredAiProductionProofFiles}`);
  if (remoteAiProductionProofs.files.length < requiredAiProductionProofFiles) {
    throw new RemoteMaterialValidationError({
      material: "ai-production-proof",
      expected: requiredAiProductionProofFiles,
      actual: remoteAiProductionProofs.files.length,
      message: `百度网盘AI制作证明数量不足。` +
        `至少需要${requiredAiProductionProofFiles}个文件，实际找到${remoteAiProductionProofs.files.length}个。` +
        `请在分享资源中添加文件名或目录名包含“AI制作证明”的图片/PDF。`,
    });
  }
  // Keep the large video download scoped to the selected episode directory. Every matched
  // ownership root is submitted separately as a complete directory below.
  const downloadTargetName = targetName;
  const task = {
    targetName: videoTargetName,
    savedPath: saved.savedPath,
    fsId: saved.fsId,
    downloadRoot: downloadDir,
  };
  let downloadRoot = downloadDir;
  const nativeSubmitted = downloadEpisodeVideos
    ? await submitNativeDownloadTask(port, task)
    : true;
  let videoSubmitted = nativeSubmitted;
  if (downloadEpisodeVideos && nativeSubmitted) {
    await openClientTransfers(port);
    const started = Date.now();
    while (Date.now() - started < 15000) {
      if (await isPresentInClientTransfers(port, videoTargetName)) {
        break;
      }
      await sleep(500);
    }
    if (!await isPresentInClientTransfers(port, videoTargetName)) {
      videoSubmitted = false;
      log(`客户端内部下载任务未出现在传输列表，回退界面下载：${videoTargetName}`);
    }
  }

  // Download the small ownership directory as one task. Baidu's native API treats
  // file paths as directories, so submitting individual images creates empty folders.
  const ownershipTaskNames: string[] = [];
  const submittedAssetRoots = new Set<string>(
    downloadEpisodeVideos ? [remoteVideos.rootPath] : [],
  );
  const normalizeAssetPath = (value: string) =>
    `/${String(value || "").split("/").filter(Boolean).join("/")}`;
  const assertDedicatedAssetRoot = (assetRoot: string, materialName: string) => {
    if (
      !downloadEpisodeVideos
      && remoteVideos.allVideoFiles.length > 0
      && normalizeAssetPath(assetRoot) === normalizeAssetPath(remoteVideos.rootPath)
    ) {
      throw new Error(
        `百度网盘${materialName}与正片视频混放在同一目录，素材-only 模式不会下载该目录。` +
          `请将${materialName}放入独立子目录后重试。`,
      );
    }
  };
  for (const ownershipRoot of downloadAssetMaterials ? remoteOwnership.roots : []) {
    if (!ownershipRoot.path || !ownershipRoot.fsId || submittedAssetRoots.has(ownershipRoot.path)) continue;
    assertDedicatedAssetRoot(ownershipRoot.path, "权属文件");
    const ownershipTaskName = ownershipRoot.path.split("/").filter(Boolean).pop() || "权属文件";
    const localOwnershipCandidates = downloadDir
      ? [
        path.join(downloadDir, saved.resourceRootName, ownershipTaskName),
        path.join(downloadDir, ownershipTaskName),
      ]
      : [];
    const localOwnershipImageCounts = await Promise.all(
      localOwnershipCandidates.map(countLocalOwnershipImages),
    );
    if (remoteOwnership.files.length > 0 && Math.max(0, ...localOwnershipImageCounts) >= remoteOwnership.files.length) {
      log(`本地已有完整权属目录，跳过重复下载：${ownershipTaskName}`);
      submittedAssetRoots.add(ownershipRoot.path);
      continue;
    }
    const ownershipSubmitted = await submitNativeDownloadTask(port, {
      targetName: ownershipTaskName,
      savedPath: ownershipRoot.path,
      fsId: ownershipRoot.fsId,
      downloadRoot: downloadDir,
    });
    if (!ownershipSubmitted) {
      throw new Error(`百度网盘权属目录下载任务提交失败：${ownershipTaskName}`);
    }
    ownershipTaskNames.push(ownershipTaskName);
    submittedAssetRoots.add(ownershipRoot.path);
  }

  for (const posterRoot of downloadAssetMaterials ? remotePosters.roots : []) {
    if (!posterRoot.path || !posterRoot.fsId || submittedAssetRoots.has(posterRoot.path)) continue;
    assertDedicatedAssetRoot(posterRoot.path, "海报封面");
    const posterTaskName = posterRoot.path.split("/").filter(Boolean).pop() || "海报封面";
    const localPosterCandidates = downloadDir
      ? [path.join(downloadDir, saved.resourceRootName, posterTaskName), path.join(downloadDir, posterTaskName)]
      : [];
    const localPosterCounts = await Promise.all(localPosterCandidates.map(countLocalPosterImages));
    if (remotePosters.files.length > 0 && Math.max(0, ...localPosterCounts) >= remotePosters.files.length) {
      log(`本地已有海报封面素材，跳过重复下载：${posterTaskName}`);
      continue;
    }
    const posterSubmitted = await submitNativeDownloadTask(port, {
      targetName: posterTaskName,
      savedPath: posterRoot.path,
      fsId: posterRoot.fsId,
      downloadRoot: downloadDir,
    });
    if (!posterSubmitted) throw new Error(`百度网盘海报封面目录下载任务提交失败：${posterTaskName}`);
  }

  if (downloadAssetMaterials && requiredAiProductionProofFiles > 0) {
    for (const proofRoot of remoteAiProductionProofs.roots) {
      if (!proofRoot.path || !proofRoot.fsId || submittedAssetRoots.has(proofRoot.path)) continue;
      assertDedicatedAssetRoot(proofRoot.path, "AI制作证明");
      const proofTaskName = proofRoot.path.split("/").filter(Boolean).pop() || "AI制作证明";
      const proofSubmitted = await submitNativeDownloadTask(port, {
        targetName: proofTaskName,
        savedPath: proofRoot.path,
        fsId: proofRoot.fsId,
        downloadRoot: downloadDir,
      });
      if (!proofSubmitted) throw new Error(`百度网盘AI制作证明下载任务提交失败：${proofTaskName}`);
      submittedAssetRoots.add(proofRoot.path);
    }
  }

  if (downloadEpisodeVideos && !videoSubmitted) {
    await downloadSavedFolderFromClientSearch(port, videoTargetName);
    downloadRoot = await confirmDownloadSetting(port, downloadDir);
    await waitForDownloadSubmitted(port, { ...task, downloadRoot });
  }
  return {
    downloadRoot,
    targetName: downloadTargetName,
    remoteVideos,
    remoteOwnership,
    remotePosters,
    remoteAiProductionProofs,
    inferredEpisodeCount,
  };
}

async function downloadBaiduNetdiskSharePromise(
  options: BaiduNetdiskShareDownloadOptions,
): Promise<BaiduNetdiskShareDownloadResult> {
  if (process.platform !== "win32") {
    throw new Error("当前脚本实现的是 Windows 百度网盘 CDP 下载流程。");
  }

  const port = options.port ?? 9337;
  const downloadDir = options.downloadDir?.trim() || DEFAULT_BAIDU_NETDISK_DOWNLOAD_DIR;

  let content: string;
  let share: ShareInfo;
  if (typeof options.shareText === "string" && options.shareText.trim()) {
    content = options.shareText;
    share = parseBaiduNetdiskShareText(content);
  } else if (typeof options.shareFile === "string" && options.shareFile.trim()) {
    const loaded = await readShareInfo(options.shareFile);
    content = loaded.content;
    share = loaded.share;
  } else {
    throw new Error("必须提供 shareText 或 --share-file，不能使用默认分享文件。");
  }

  if (options.resourceName?.trim()) {
    share = {
      ...share,
      name: sanitizeWindowsName(options.resourceName),
    };
  }

  await mkdir(downloadDir, { recursive: true });

  log(`读取分享：${share.name}`);
  log(`默认下载目录：${downloadDir}`);

  const clipboardResult = await copyToClipboard(content);
  if (clipboardResult.copied) {
    log("已复制分享内容到剪贴板");
  } else {
    log(`复制分享内容到剪贴板失败，继续使用已解析的分享链接：${clipboardResult.error}`);
  }

  await ensureBaiduCdpPort(port);
  log(`使用百度网盘 CDP 端口：${port}`);

  const shareTarget = await openSharePage(port, share);
  await enterShareCode(shareTarget, share);
  const listTarget = await waitForShareList(port, share, [shareTarget]);
  const {
    downloadRoot,
    targetName,
    remoteVideos,
    remoteOwnership,
    remotePosters,
    remoteAiProductionProofs,
    inferredEpisodeCount,
  } = await submitSavedDownload(
    port,
    listTarget,
    share,
    downloadDir,
    options.downloadEpisodeVideos === false ? undefined : options.expectedEpisodeCount,
    options.expectedOwnershipCounts,
    options.expectedOwnershipFiles,
    options.expectedPosterImages,
    options.expectedAiProductionProofFiles,
    options.downloadEpisodeVideos !== false,
    options.inferEpisodeCount === true,
    options.downloadAssetMaterials !== false,
  );
  const resolvedDownloadRoot = downloadRoot ?? downloadDir;
  const predictedLocalPath = path.join(resolvedDownloadRoot, targetName);
  log(`下载任务已提交，不等待本地完成：${predictedLocalPath}`);

  return {
    share: {
      ...share,
      name: targetName,
    },
    downloadRoot: resolvedDownloadRoot,
    localPath: predictedLocalPath,
    remoteVideos,
    remoteOwnership,
    remotePosters,
    remoteAiProductionProofs,
    expectedOwnershipImages: remoteOwnership.files.length,
    expectedOwnershipFiles: remoteOwnership.allFiles.length,
    expectedPosterImages: remotePosters.files.length,
    expectedAiProductionProofFiles: remoteAiProductionProofs.files.length,
    inferredEpisodeCount,
    completed: false,
    skippedExisting: false,
  };
}

export function downloadBaiduNetdiskShareEffect(
  options: BaiduNetdiskShareDownloadOptions,
): Effect.Effect<BaiduNetdiskShareDownloadResult, BaiduNetdiskAutomationError> {
  return Effect.tryPromise({
    try: () => downloadBaiduNetdiskSharePromise(options),
    catch: (error) => classifyBaiduNetdiskAutomationError(error),
  });
}

export function downloadBaiduNetdiskShare(options: BaiduNetdiskShareDownloadOptions) {
  return runPromisePreservingFailure(downloadBaiduNetdiskShareEffect(options));
}
