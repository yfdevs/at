import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureBaiduCdpPort,
  getTargets,
  waitForDocumentBody,
  waitForTarget,
  withPage,
} from "./cdp.js";
import { parseCliOptions } from "./cli.js";
import {
  DEFAULT_BAIDU_NETDISK_DOWNLOAD_DIR,
  DEFAULT_BAIDU_NETDISK_SHARE_NAME,
  DOWNLOAD_SETTING_MAX_ATTEMPTS,
  OWN_NETDISK_DIR_LIST_MAX_PAGES,
  REMOTE_DIR_ENTRY_SAMPLE_LIMIT,
  REMOTE_VIDEO_SCAN_MAX_DEPTH,
  REMOTE_VIDEO_SCAN_MAX_DIRS,
  SHARE_LIST_MAX_PAGES,
} from "./constants.js";
import { log, logRemoteVideoScanDetails } from "./logging.js";
import { parseBaiduNetdiskShareText, readShareInfo, sanitizeWindowsName } from "./share-text.js";
import type {
  BaiduNetdiskDownloadTaskStatus,
  BaiduNetdiskRemoteOwnershipListing,
  BaiduNetdiskRemoteVideoListing,
  BaiduNetdiskShareDownloadOptions,
  BaiduNetdiskShareDownloadResult,
  CdpTarget,
  Rect,
  ShareInfo,
} from "./types.js";
import { sleep } from "./utils.js";

export { DEFAULT_BAIDU_NETDISK_DOWNLOAD_DIR } from "./constants.js";
export { parseBaiduNetdiskShareText } from "./share-text.js";
export type {
  BaiduNetdiskDownloadTaskStatus,
  BaiduNetdiskRemoteEpisodeFile,
  BaiduNetdiskRemoteOwnershipFile,
  BaiduNetdiskRemoteOwnershipListing,
  BaiduNetdiskRemoteVideoListing,
  BaiduNetdiskShareDownloadOptions,
  BaiduNetdiskShareDownloadResult,
  BaiduNetdiskShareInfo,
} from "./types.js";

async function copyToClipboard(text: string) {
  if (process.platform !== "win32") {
    log("当前不是 Windows，跳过 Set-Clipboard。");
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-Command", "Set-Clipboard -Value ([Console]::In.ReadToEnd())"],
      { stdio: ["pipe", "ignore", "pipe"] },
    );

    let errorOutput = "";
    child.stderr.on("data", (chunk: Buffer) => {
      errorOutput += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(errorOutput || `Set-Clipboard exited with ${code}`));
    });
    child.stdin.end(text);
  });
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
  remoteVideos: BaiduNetdiskRemoteVideoListing;
  remoteOwnership: BaiduNetdiskRemoteOwnershipListing;
};

async function saveShareToOwnNetdisk(target: CdpTarget, share: ShareInfo) {
  return withPage(target, async (page) => {
    log("保存分享目录到我的网盘");
    const result = await page.evaluate<SavedShareResult>(
      `
(async () => {
  const SHARE_LIST_MAX_PAGES = ${SHARE_LIST_MAX_PAGES};
  const OWN_NETDISK_DIR_LIST_MAX_PAGES = ${OWN_NETDISK_DIR_LIST_MAX_PAGES};
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
  const fetchShareFileList = async () => {
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
        dir: "/",
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
  const file =
    fileList.find((item) => fileNameOf(item) === expectedName) ||
    fileList.find(isExpectedFile) ||
    fileList[0];
  const fileFsId = fileFsIdOf(file);
  if (!fileFsId) {
    throw new Error(
      "分享页没有解析到可转存文件元数据，无法保存到我的网盘。share/list=" +
        shareListAttempts.slice(-5).join(" | ")
    );
  }
  const sourceName = fileNameOf(file);
  if (shouldUseSourceName && sourceName) {
    expectedName = sourceName;
  }
  const baseQuery =
    "channel=chunlei&web=1&app_id=250528&bdstoken=" +
    encodeURIComponent(token) +
    "&clienttype=0";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const attempts = [];
  let transferredPath = "";
  let transferredName = "";
  let transferredFsId = "";
  const rootPath = "/" + expectedName;
  const sourceRootPath = sourceName ? "/" + sourceName : "";
  const itemName = (item) => String(item?.server_filename || item?.path?.split("/")?.pop() || "");
  const itemPath = (item) => String(item?.path || "");
  const itemFsId = (item) => String(item?.fs_id || item?.fsid || item?.id || "");
  const isTransferredItem = (item) =>
    Boolean(transferredPath && itemPath(item) === transferredPath) ||
    Boolean(transferredName && itemName(item) === transferredName) ||
    Boolean(transferredFsId && itemFsId(item) === transferredFsId);
  const isExactItem = (item) =>
    isTransferredItem(item) ||
    itemName(item) === expectedName ||
    item?.path === rootPath ||
    Boolean(sourceName && (itemName(item) === sourceName || itemPath(item) === sourceRootPath));
  const isLikelyNewCopy = (item) => {
    const name = itemName(item);
    return isTransferredItem(item) ||
      [expectedName, sourceName].some((baseName) =>
        baseName &&
        (name === baseName ||
          name.startsWith(baseName + "(") ||
          name.startsWith(baseName + "（") ||
          name.startsWith(baseName + " - ") ||
          name.startsWith(baseName + "_")),
      );
  };

  const searchOwnItem = async (allowCopyName = false) => {
    const keys = [...new Set([transferredName, sourceName, expectedName].filter(Boolean))];
    try {
      for (const key of keys) {
        const data = await jsonFetch(
          "/api/search?recursion=1&key=" + encodeURIComponent(key) + "&" + baseQuery,
        );
        if (data.errno !== 0) {
          attempts.push("search key=" + key + " errno=" + data.errno + " " + compactJson(data));
          continue;
        }
        const list = Array.isArray(data.list) ? data.list : [];
        const found = list.find(isExactItem) || (allowCopyName ? list.find(isLikelyNewCopy) : undefined);
        if (found) return found;
      }
      return undefined;
    } catch (error) {
      attempts.push("search error=" + String(error?.message || error));
      return undefined;
    }
  };

  const listOwnRootItem = async (allowCopyName = false) => {
    try {
      const data = await jsonFetch(
        "/api/list?dir=%2F&order=time&desc=1&num=100&page=1&" + baseQuery,
      );
      if (data.errno !== 0) {
        attempts.push("list errno=" + data.errno + " " + compactJson(data));
        return undefined;
      }
      const list = Array.isArray(data.list) ? data.list : [];
      return list.find(isExactItem) || (allowCopyName ? list.find(isLikelyNewCopy) : undefined);
    } catch (error) {
      attempts.push("list error=" + String(error?.message || error));
      return undefined;
    }
  };

  const locateOwnItem = async (allowCopyName = false) => {
    const byList = await listOwnRootItem(allowCopyName);
    if (byList) return { item: byList, source: "list" };

    const bySearch = await searchOwnItem(allowCopyName);
    if (bySearch) return { item: bySearch, source: "search" };

    return undefined;
  };

  let located = await locateOwnItem(false);
  let ownRoot = located?.item;
  let locateSource = located?.source || "";
  let alreadySaved = Boolean(ownRoot);
  let transferResponse;
  if (!ownRoot) {
    const sekey =
      localStorage.getItem(surl + "_bdclnd") ||
      (document.cookie.match(/(?:^|; )BDCLND=([^;]+)/) || [])[1] ||
      "";
    const params = new URLSearchParams({
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
    const body = new URLSearchParams({
      fsidlist: JSON.stringify([fileFsId]),
      path: "/",
    });
    const saved = await jsonFetch("/share/transfer?" + params.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    transferResponse = saved;
    if (saved.errno !== 0) {
      const message = String(saved.show_msg || saved.errmsg || saved.message || "");
      if (saved.errno === -6 || message.includes("账户已过期") || message.includes("重新登陆")) {
        throw new Error("百度网盘账号登录已过期，请在百度网盘客户端重新登录后再下载。");
      }

      throw new Error(
        "保存分享到网盘失败：" +
          (message || "百度接口返回异常") +
          "；errno=" +
          String(saved.errno) +
          (saved.request_id ? "；request_id=" + String(saved.request_id) : "")
      );
    }
    const transferList = Array.isArray(saved?.extra?.list) ? saved.extra.list : [];
    const transferItem = transferList.find((item) => item?.to || item?.to_fs_id) || {};
    transferredPath = String(transferItem.to || "");
    transferredName = transferredPath.split("/").filter(Boolean).pop() || "";
    transferredFsId = String(transferItem.to_fs_id || "");

    const started = Date.now();
    while (Date.now() - started < 70000) {
      located = await locateOwnItem(true);
      if (located?.item) {
        ownRoot = located.item;
        locateSource = located.source;
        break;
      }
      await sleep(1000);
    }
  }
  if (!ownRoot && (transferredPath || transferredName || transferredFsId)) {
    ownRoot = {
      server_filename: transferredName || transferredPath.split("/").filter(Boolean).pop() || expectedName,
      path: transferredPath || "/" + (transferredName || expectedName),
      fs_id: transferredFsId,
    };
    locateSource = "transfer";
  }
  if (!ownRoot) {
    throw new Error(
      "保存后没有在自有网盘中找到目标文件。transfer=" +
        compactJson(transferResponse || {}) +
        "；attempts=" +
        attempts.slice(-OWN_NETDISK_ATTEMPT_LOG_LIMIT).join(" | "),
    );
  }

  const savedPath = ownRoot.path || transferredPath || "/" + (ownRoot.server_filename || transferredName || sourceName || expectedName);
  const finalFileName = ownRoot.server_filename || transferredName || sourceName || expectedName;
  const normalizeDir = (dir) => "/" + String(dir || "").split("/").filter(Boolean).join("/");
  const joinPath = (dir, name) => normalizeDir(normalizeDir(dir) + "/" + name);
  const escapeRegExp = (value) => String(value).replace(/[\\\\^$.*+?()[\\]{}|]/g, "\\\\$&");
  const episodeBaseNames = [...new Set([expectedName, sourceName, finalFileName].filter(Boolean))];
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
    const pageSize = 1000;
    for (let page = 1; page <= OWN_NETDISK_DIR_LIST_MAX_PAGES; page += 1) {
      const data = await jsonFetch(
        "/api/list?dir=" +
          encodeURIComponent(normalizedDir) +
          "&order=name&desc=0&num=" +
          pageSize +
          "&page=" +
          page +
          "&" +
          baseQuery,
      );
      if (data.errno !== 0) {
        if (page === 1) attempts.push("list dir=" + normalizedDir + " errno=" + data.errno + " " + compactJson(data));
        debug.errno = data.errno;
        break;
      }
      const list = Array.isArray(data.list) ? data.list : [];
      results.push(...list);
      debug.hasMore = Boolean(data.has_more);
      if (list.length < pageSize && !data.has_more) break;
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
  const queue = [{
    path: normalizeDir(savedPath),
    name: finalFileName,
    fsId: itemFsId(ownRoot),
    depth: 0,
  }];
  const allEntriesByPath = new Map();
  const ownershipByKind = { juchuang: new Map(), jianying: new Map(), contract: new Map() };
  let ownershipRootPath = "";
  let ownershipRootFsId = "";
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
    const directEntriesByPath = new Map();
    for (const entry of entries) {
      const name = itemName(entry);
      const entryPath = itemPath(entry) || joinPath(current.path, name);
      if (entry?.isdir === 1 || entry?.isdir === true) {
        if (current.depth < REMOTE_VIDEO_SCAN_MAX_DEPTH) {
          queue.push({
            path: normalizeDir(entryPath),
            name,
            fsId: itemFsId(entry),
            depth: current.depth + 1,
          });
        }
        continue;
      }
      const lowerName = name.toLowerCase();
      if (/\.(?:png|jpe?g)$/i.test(lowerName)) {
        const compactName = name.replace(/\s+/g, "");
        const kind = compactName.includes("合同") || compactName.includes("contract")
          ? "contract"
          : compactName.includes("剧创") || compactName.includes("即梦")
          ? "juchuang"
          : compactName.includes("剪映") ? "jianying" : "";
        if (kind) {
          if (!ownershipRootPath) {
            ownershipRootPath = current.path;
            ownershipRootFsId = current.fsId;
          }
          const stem = name.replace(/\.[^.]+$/, "");
          const indexMatch = stem.match(/(\d{1,4})\s*$/);
          ownershipByKind[kind].set(entryPath, {
            kind,
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
    remoteVideos: {
      rootPath: selectedVideoDir.path || savedPath,
      files,
      allVideoFiles,
      unmatchedVideoFiles,
      scannedDirs,
      duplicateIndexes,
    },
    remoteOwnership: Object.assign(Object.fromEntries(["juchuang", "jianying", "contract"].map((kind) => {
      const seenIndexes = new Set();
      const files = [...ownershipByKind[kind].values()]
        .sort((left, right) => (left.index ?? Number.MAX_SAFE_INTEGER) - (right.index ?? Number.MAX_SAFE_INTEGER) || left.path.localeCompare(right.path))
        .filter((file) => {
          if (file.index === undefined) return true;
          if (seenIndexes.has(file.index)) return false;
          seenIndexes.add(file.index);
          return true;
        });
      return [kind, files];
    })), { rootPath: ownershipRootPath, rootFsId: ownershipRootFsId }),
  };
})()
`,
      90000,
    );

    if (!result.savedPath) throw new Error("没有拿到保存后的网盘路径。");
    return result;
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

export async function controlBaiduNetdiskDownloadTask(options: { port?: number; targetName: string; action: "pause" | "resume" | "delete" }) {
  const target = findUsableCoreTarget(await getTargets(options.port ?? 9337));
  if (!target) throw new Error("百度网盘 CDP 页面不可用。");
  return withPage(target, (page) => page.evaluate(`(async()=>{const app=require("@electron/remote").app;const wanted=${JSON.stringify(options.targetName)};const action=${JSON.stringify(options.action)};const d=app.$downloader;let payload;d.getDownloadTasks((e,f,i)=>payload=i,0,1000,"0");for(let n=0;!payload&&n<20;n++)await new Promise(r=>setTimeout(r,100));const list=Array.isArray(payload?.tasks)?payload.tasks:[];const t=list.find(x=>String(x?.name||x?.server_path||"").includes(wanted));if(!t)throw new Error("未找到下载任务");const id=t.id;const names=action==="pause"?["pauseTask","pauseDownloadTask","pause"]:action==="resume"?["resumeTask","resumeDownloadTask","startTask"]:["deleteTask","removeTask","deleteDownloadTask"];const fn=names.find(k=>typeof d[k]==="function");if(!fn)throw new Error("百度网盘当前版本不支持该操作");await Promise.resolve(d[fn](id));return true;})()`));
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

async function submitSavedDownload(
  port: number,
  shareTarget: CdpTarget,
  share: ShareInfo,
  downloadDir?: string,
  expectedEpisodeCount?: number,
  expectedOwnershipCounts?: BaiduNetdiskShareDownloadOptions["expectedOwnershipCounts"],
) {
  const saved = await saveShareToOwnNetdisk(shareTarget, share);
  log(
    saved.alreadySaved
      ? `网盘中已存在目录：${saved.savedPath} (${saved.locateSource})`
      : `已保存到网盘：${saved.savedPath} (${saved.locateSource})`,
  );

  const targetName = saved.fileName || share.name;
  log(`选中视频目录：${saved.savedPath}，名称=${targetName}`);
  const remoteVideos = saved.remoteVideos;
  const remoteOwnership = saved.remoteOwnership;
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
  if (expectedEpisodeCount !== undefined) {
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
      const problemParts = [
        missingIndexes.length > 0 ? `缺失=${formatNumberRanges(missingIndexes)}` : "",
        unexpectedIndexes.length > 0 ? `超出=${formatNumberRanges(unexpectedIndexes)}` : "",
        remoteVideos.duplicateIndexes.length > 0
          ? `重复=${formatNumberRanges(remoteVideos.duplicateIndexes)}`
          : "",
      ].filter(Boolean);
      throw new Error(
        `百度网盘剧集视频数量不正确：${targetName}。` +
          `期望1-${expectedEpisodeCount}共${expectedIndexes.length}集，` +
          `实际${formatNumberRanges(remoteIndexes)}共${remoteVideos.files.length}集。` +
          (problemParts.length > 0 ? `问题：${problemParts.join("；")}。` : ""),
      );
    }
  }
  const requiredJuchuang = Math.max(0, expectedOwnershipCounts?.juchuang ?? 0);
  const requiredJianying = Math.max(0, expectedOwnershipCounts?.jianying ?? 0);
  log(
    `网盘权属材料清单：剧创=${remoteOwnership.juchuang.length}/${requiredJuchuang}，` +
      `剪映=${remoteOwnership.jianying.length}/${requiredJianying}`,
  );
  if (
    remoteOwnership.juchuang.length < requiredJuchuang
    || remoteOwnership.jianying.length < requiredJianying
  ) {
    throw new Error(
      `百度网盘权属材料数量不足：${targetName}。` +
        `剧创要求${requiredJuchuang}张，远程${remoteOwnership.juchuang.length}张；` +
        `剪映要求${requiredJianying}张，远程${remoteOwnership.jianying.length}张。`,
    );
  }
  // Keep the large video download scoped to the selected episode directory. Ownership
  // images are submitted as individual files below, so unrelated share folders are skipped.
  const downloadTargetName = targetName;
  const task = {
    targetName: downloadTargetName,
    savedPath: saved.savedPath,
    fsId: saved.fsId,
    downloadRoot: downloadDir,
  };
  let downloadRoot = downloadDir;
  const nativeSubmitted = await submitNativeDownloadTask(port, task);
  let videoSubmitted = nativeSubmitted;
  if (nativeSubmitted) {
    await openClientTransfers(port);
    const started = Date.now();
    while (Date.now() - started < 15000) {
      if (await isPresentInClientTransfers(port, downloadTargetName)) {
        break;
      }
      await sleep(500);
    }
    if (!await isPresentInClientTransfers(port, downloadTargetName)) {
      videoSubmitted = false;
      log(`客户端内部下载任务未出现在传输列表，回退界面下载：${downloadTargetName}`);
    }
  }

  // Download the small ownership directory as one task. Baidu's native API treats
  // file paths as directories, so submitting individual images creates empty folders.
  if (remoteOwnership.rootPath && remoteOwnership.rootFsId) {
    await submitNativeDownloadTask(port, {
      targetName: remoteOwnership.rootPath.split("/").filter(Boolean).pop() || "权属文件",
      savedPath: remoteOwnership.rootPath,
      fsId: remoteOwnership.rootFsId,
      downloadRoot: downloadDir,
    });
  }

  if (!videoSubmitted) {
    await downloadSavedFolderFromClientSearch(port, downloadTargetName);
    downloadRoot = await confirmDownloadSetting(port, downloadDir);
    await waitForDownloadSubmitted(port, { ...task, downloadRoot });
  }
  return { downloadRoot, targetName: downloadTargetName, remoteVideos, remoteOwnership };
}

export async function downloadBaiduNetdiskShare(
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

  await copyToClipboard(content);
  log("已复制分享内容到剪贴板");

  await ensureBaiduCdpPort(port);
  log(`使用百度网盘 CDP 端口：${port}`);

  const shareTarget = await openSharePage(port, share);
  await enterShareCode(shareTarget, share);
  const listTarget = await waitForShareList(port, share, [shareTarget]);
  const { downloadRoot, targetName, remoteVideos, remoteOwnership } = await submitSavedDownload(
    port,
    listTarget,
    share,
    downloadDir,
    options.expectedEpisodeCount,
    options.expectedOwnershipCounts,
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
    completed: false,
    skippedExisting: false,
  };
}

function isCliEntrypoint() {
  const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return entryPath === fileURLToPath(import.meta.url);
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  await downloadBaiduNetdiskShare(parseCliOptions(args));
  console.log("成功");
}

if (isCliEntrypoint()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
