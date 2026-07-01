import { spawn } from "node:child_process";
import { access, mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const debugHost = "127.0.0.1";
const requestTimeoutMs = 2500;

export const DEFAULT_BAIDU_NETDISK_DOWNLOAD_DIR = "D:\\BaiduNetdiskDownload";

export type DownloadStrategy = "auto" | "direct" | "save";

type CdpTarget = {
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
};

type CdpMessage = {
  id?: number;
  result?: unknown;
  error?: unknown;
};

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BaiduNetdiskShareInfo = {
  link: string;
  pwd: string;
  name: string;
};

type ShareInfo = BaiduNetdiskShareInfo;

export type BaiduNetdiskShareDownloadOptions = {
  shareText?: string;
  shareFile?: string;
  port?: number;
  waitCompleteMs?: number;
  forceClick?: boolean;
  strategy?: DownloadStrategy;
  downloadDir?: string;
};

export type BaiduNetdiskShareDownloadResult = {
  share: BaiduNetdiskShareInfo;
  downloadRoot?: string;
  localPath?: string;
  completed: boolean;
  skippedExisting: boolean;
};

type DownloadStatus = {
  exists: boolean;
  files: number;
  partials: number;
  bytes: number;
  latestWriteMs: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message: string) => console.log(`[baidu] ${message}`);

function getArg(args: string[], name: string) {
  const equalArg = args.find((arg) => arg.startsWith(`${name}=`));
  if (equalArg) return equalArg.slice(name.length + 1);

  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return undefined;
}

function numberArg(args: string[], name: string) {
  const value = getArg(args, name);
  if (!value) return undefined;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} 必须是数字。`);
  return parsed;
}

function parseDownloadStrategy(value: string): DownloadStrategy {
  if (value === "auto" || value === "direct" || value === "save") return value;
  throw new Error("--strategy 必须是 auto、direct 或 save。");
}

function parseCliOptions(args: string[]): BaiduNetdiskShareDownloadOptions {
  return {
    shareFile: getArg(args, "--share-file"),
    port: numberArg(args, "--port") ?? 9337,
    waitCompleteMs: numberArg(args, "--wait-complete-ms") ?? 60 * 60 * 1000,
    forceClick: args.includes("--force-click"),
    strategy: parseDownloadStrategy(
      getArg(args, "--strategy") ?? getArg(args, "--download-strategy") ?? "auto",
    ),
    downloadDir: getArg(args, "--download-dir") ?? DEFAULT_BAIDU_NETDISK_DOWNLOAD_DIR,
  };
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getJson<T>(url: string, timeoutMs = requestTimeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function trimShareLink(value: string) {
  return value.replace(/[),，。；;、\]]+$/g, "");
}

export function parseBaiduNetdiskShareText(
  content: string,
  sourceLabel = "分享文本",
): BaiduNetdiskShareInfo {
  const link = trimShareLink(content.match(/https?:\/\/pan\.baidu\.com\/s\/[^\s"'<>]+/)?.[0] ?? "");
  if (!link) throw new Error(`${sourceLabel} 中没有找到百度网盘分享链接。`);

  const url = new URL(link);
  const pwd =
    url.searchParams.get("pwd") ??
    content.match(/(?:提取码|密码|pwd)[:：\s]*([a-zA-Z0-9]{4})/)?.[1];
  if (!pwd) throw new Error(`${sourceLabel} 中没有找到提取码。`);

  const name =
    content.match(/通过网盘分享的文件[:：]\s*([^\r\n]+)/)?.[1]?.trim() ??
    content.match(/分享的文件[:：]\s*([^\r\n]+)/)?.[1]?.trim() ??
    "百度网盘分享";

  return { link, pwd, name: sanitizeWindowsName(name) };
}

async function readShareInfo(shareFile: string) {
  const fullPath = path.resolve(process.cwd(), shareFile);
  const content = await readFile(fullPath, "utf8");
  return {
    content,
    share: parseBaiduNetdiskShareText(content, shareFile),
  };
}

function sanitizeWindowsName(value: string) {
  const sanitized = value.replace(/[\\/:*?"<>|]/g, "_").trim();
  return sanitized || "百度网盘分享";
}

function websocketDataToString(data: unknown) {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (Array.isArray(data)) {
    return Buffer.concat(
      data.map((item) =>
        Buffer.isBuffer(item) ? item : Buffer.from(item as ArrayBuffer),
      ),
    ).toString("utf8");
  }

  return String(data);
}

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

async function getTargets(port: number) {
  return getJson<CdpTarget[]>(`http://${debugHost}:${port}/json/list`);
}

async function isBaiduCdpPort(port: number) {
  try {
    const version = await getJson<{ "User-Agent"?: string }>(
      `http://${debugHost}:${port}/json/version`,
    );
    const targets = await getTargets(port);
    const userAgent = version["User-Agent"] ?? "";
    const hasBaiduTarget = targets.some((target) =>
      target.url.includes("BaiduNetdisk") ||
      target.url.includes("core.asar") ||
      target.url.includes("pan.baidu.com"),
    );
    return /baidunetdisk/i.test(userAgent) || hasBaiduTarget;
  } catch {
    return false;
  }
}

async function ensureBaiduCdpPort(port: number) {
  if (await isBaiduCdpPort(port)) return;
  throw new Error(
    `端口 ${port} 不是可用百度网盘 CDP。请先退出百度网盘，再手动启动 module\\BrowserEngine\\BaiduNetdiskUnite.exe --remote-debugging-port=${port}。`,
  );
}

class CdpPage {
  private nextId = 0;
  private socket: WebSocket;
  private closed = false;

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on("close", () => {
      this.closed = true;
    });
  }

  async open() {
    await new Promise<void>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout>;
      const cleanup = () => {
        clearTimeout(timeout);
        this.socket.off("open", onOpen);
        this.socket.off("error", onError);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("CDP WebSocket 连接失败。"));
      };

      timeout = setTimeout(() => {
        cleanup();
        reject(new Error("CDP WebSocket 连接超时。"));
      }, 10000);

      this.socket.once("open", onOpen);
      this.socket.once("error", onError);
    });
    await this.send("Runtime.enable");
    await this.send("Page.enable").catch(() => undefined);
  }

  close() {
    if (!this.closed) this.socket.close();
  }

  async send<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 15000,
  ) {
    if (this.closed) throw new Error("CDP 页面已关闭。");

    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        this.socket.off("message", onMessage);
        this.socket.off("close", onClose);
      };
      const onClose = () => {
        cleanup();
        reject(new Error("CDP 页面已关闭。"));
      };
      const onMessage = (data: unknown) => {
        const message = JSON.parse(websocketDataToString(data)) as CdpMessage;
        if (message.id !== id) return;

        cleanup();
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result as T);
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`${method} 超时。`));
      }, timeoutMs);

      this.socket.on("message", onMessage);
      this.socket.once("close", onClose);

      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  async evaluate<T>(expression: string, timeoutMs = 15000) {
    const response = await this.send<{
      result?: { value?: T; description?: string };
      exceptionDetails?: {
        text?: string;
        exception?: { description?: string; value?: string };
      };
    }>(
      "Runtime.evaluate",
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
      },
      timeoutMs,
    );
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ??
          response.exceptionDetails.exception?.value ??
          response.exceptionDetails.text ??
          "CDP 执行脚本异常。",
      );
    }
    if (!response.result) throw new Error("CDP 执行脚本失败。");
    return response.result.value as T;
  }

  async navigate(url: string, timeoutMs = 15000) {
    await this.send("Page.navigate", { url }, timeoutMs);
  }

  async clickPoint(x: number, y: number, allowPageClose = false) {
    try {
      await this.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
        button: "none",
      });
      await this.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        buttons: 1,
        clickCount: 1,
      });
      await this.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
    } catch (error) {
      if (!allowPageClose) throw error;
    }
  }

  async pressEnter() {
    await this.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
  }
}

async function withPage<T>(target: CdpTarget, run: (page: CdpPage) => Promise<T>) {
  if (!target.webSocketDebuggerUrl) throw new Error("目标页面没有 WebSocket 调试地址。");

  const page = new CdpPage(target.webSocketDebuggerUrl);
  await page.open();
  try {
    return await run(page);
  } finally {
    page.close();
  }
}

async function waitForDocumentBody(page: CdpPage, timeoutMs = 15000) {
  const loaded = await page.evaluate<boolean>(
    `
(async () => {
  const started = Date.now();
  while (!document.body && Date.now() - started < ${timeoutMs}) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return Boolean(document.body);
})()
`,
    timeoutMs + 1000,
  );

  if (!loaded) throw new Error("页面 body 未加载完成。");
}

async function waitForTarget(
  port: number,
  predicate: (target: CdpTarget) => boolean,
  timeoutMs = 15000,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const target = (await getTargets(port)).find(
      (item) => item.webSocketDebuggerUrl && predicate(item),
    );
    if (target) return target;
    await sleep(300);
  }

  throw new Error("没有找到目标页面。");
}

function shareId(link: string) {
  const url = new URL(link);
  const id = url.pathname.split("/").pop() ?? "";
  return id.replace(/^1/, "");
}

function isShareTarget(target: CdpTarget, id: string) {
  return (
    target.url.includes("pan.baidu.com") &&
    (target.url.includes(id) || target.url.includes(encodeURIComponent(id)))
  );
}

async function findShareTarget(port: number, id: string) {
  const targets = await getTargets(port);
  return targets.find((target) => target.webSocketDebuggerUrl && isShareTarget(target, id));
}

async function waitForShareTarget(port: number, id: string, timeoutMs = 20000) {
  return waitForTarget(port, (target) => isShareTarget(target, id), timeoutMs);
}

async function navigateToShareBestEffort(target: CdpTarget, share: ShareInfo) {
  await withPage(target, async (page) => {
    if (target.url.includes("pan.baidu.com")) {
      await page
        .evaluate(
          `(() => {
  location.assign(${JSON.stringify(share.link)});
  return location.href;
})()`,
          5000,
        )
        .catch((error) => {
          log(
            `通过页面脚本打开分享链接未返回：${error instanceof Error ? error.message : String(error)}`,
          );
        });
      return;
    }

    await page.navigate(share.link, 8000).catch((error) => {
      log(`Page.navigate 未返回，继续等待目标页面：${error instanceof Error ? error.message : String(error)}`);
    });
  });
}

async function openSharePage(port: number, share: ShareInfo) {
  const id = shareId(share.link);
  const targets = await getTargets(port);
  const existing = targets.find((target) => target.webSocketDebuggerUrl && isShareTarget(target, id));
  if (existing) return existing;

  const reusable =
    targets.find(
      (target) =>
        target.webSocketDebuggerUrl &&
        target.type === "webview" &&
        target.url.includes("pan.baidu.com"),
    ) ??
    targets.find(
      (target) =>
        target.webSocketDebuggerUrl &&
        target.type === "page" &&
        target.url.includes("core.asar"),
    );

  if (!reusable) throw new Error("没有找到可导航的百度网盘页面。");

  log("通过 CDP 打开分享链接");
  await navigateToShareBestEffort(reusable, share);

  const navigated = await findShareTarget(port, id);
  if (navigated) return navigated;

  if (reusable.url.includes("pan.baidu.com")) {
    await withPage(reusable, async (page) => {
      await page.navigate(share.link, 8000).catch((error) => {
        log(
          `Page.navigate 兜底未返回，继续等待目标页面：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    });
  }

  return waitForShareTarget(port, id, 25000);
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
        if (/提取码错误|密码错误|分享不存在|链接不存在|分享已取消|分享已过期/.test(nextState.text)) {
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
      log(`分享提取接口未直接完成，回退页面按钮：${verified.errno ?? ""} ${verified.message ?? ""}`.trim());
    }

    const prepared = await page.evaluate<{
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
    key: ${JSON.stringify(pwd.at(-1) ?? "")},
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
`).catch((error) => {
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
        .clickPoint(prepared.rect.x + prepared.rect.width / 2, prepared.rect.y + prepared.rect.height / 2)
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

async function waitForShareList(port: number, share: ShareInfo) {
  const id = shareId(share.link);
  const started = Date.now();
  while (Date.now() - started < 30000) {
    const targets = await getTargets(port);
    const target = targets.find(
      (item) =>
        item.webSocketDebuggerUrl &&
        isShareTarget(item, id),
    );
    if (!target) {
      await sleep(500);
      continue;
    }

    const state = await withPage(target, (page) =>
      page.evaluate<{ url: string; title: string; text: string }>(
        `({ url: location.href, title: document.title, text: document.body ? document.body.innerText : "" })`,
      ),
    );

    if (state.url.includes("#list") || state.text.includes("全部文件")) return target;
    if (state.text.includes("请输入验证码")) {
      throw new Error("分享页要求验证码，CDP 无法自动完成。");
    }

    await sleep(500);
  }

  throw new Error("没有进入分享文件列表。");
}

async function downloadShareFolderFromSharePage(target: CdpTarget, targetName: string) {
  return withPage(target, async (page) => {
    await waitForDocumentBody(page);
    log("从分享页直接点击下载");

    const clicked = await page.evaluate<{
      clicked: boolean;
      selected: boolean;
      captcha: boolean;
      text: string;
    }>(
      `
(async () => {
  const wanted = ${JSON.stringify(targetName)};
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
  const fireClick = (item, offsetX) => {
    if (!(item instanceof HTMLElement)) return false;
    item.scrollIntoView({ block: "center", inline: "center" });
    const rect = item.getBoundingClientRect();
    const clientX = offsetX == null ? rect.x + rect.width / 2 : rect.x + offsetX;
    const clientY = rect.y + rect.height / 2;
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      item.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY,
      }));
    }
    return true;
  };
  const isSelected = () => /已选中|已选择/.test(bodyText());

  if (!isSelected()) {
    const row = [...document.querySelectorAll("dd,tr,.u-table__row,.vdAfKMb,.NHcGw,.itemWrap,.fileItemWrapSearch")]
      .find((item) => item instanceof HTMLElement && normalizedText(item).includes(wanted));
    if (row instanceof HTMLElement) {
      const checkbox =
        row.querySelector(".u-checkbox,.checkbox,.file-select,[class*=checkbox],[class*=Checkbox]") ||
        row;
      fireClick(checkbox instanceof HTMLElement ? checkbox : row, 20);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  const candidates = [
    ...document.querySelectorAll(".bottom_download_btn,.downloadBtn,a,button,div,span"),
  ];
  const button = candidates.find((item) => {
    if (!(item instanceof HTMLElement) || !isVisible(item)) return false;
    const text = normalizedText(item);
    const title = String(item.getAttribute("title") || "").trim();
    const className = String(item.className || "");
    if (/disabled|g-disabled|is-disabled/.test(className)) return false;
    if (/客户端下载|极速下载/.test(text + title)) return false;
    return className.includes("bottom_download_btn") ||
      className.includes("downloadBtn") ||
      text === "下载" ||
      title === "下载";
  });

  if (!(button instanceof HTMLElement)) {
    return { clicked: false, selected: isSelected(), captcha: false, text: bodyText() };
  }

  fireClick(button);
  let captcha = false;
  const clickedAt = Date.now();
  while (Date.now() - clickedAt < 10000) {
    const text = bodyText();
    captcha = text.includes("请输入验证码");
    if (captcha || !text.includes("正在获取下载链接")) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (captcha) {
    const cancel = [...document.querySelectorAll("a,button,div,span")]
      .find((item) => item instanceof HTMLElement && isVisible(item) && normalizedText(item) === "取消");
    if (cancel instanceof HTMLElement) fireClick(cancel);
  }

  return { clicked: true, selected: isSelected(), captcha, text: bodyText() };
})()
`,
      20000,
    );

    if (!clicked.clicked) throw new Error("分享页没有找到可点击的下载按钮。");
    if (clicked.captcha) throw new Error("分享页直接下载要求验证码。");
    return clicked;
  });
}

type SavedShareResult = {
  fileName: string;
  savedPath: string;
  fsId: number | string;
  alreadySaved: boolean;
  locateSource: string;
};

async function saveShareToOwnNetdisk(target: CdpTarget, targetName: string) {
  return withPage(target, async (page) => {
    log("保存分享目录到我的网盘");
    const result = await page.evaluate<SavedShareResult>(
      `
(async () => {
  for (const item of document.querySelectorAll(
    ".dialog-close,#dialog1 .close,#moduleDownloadDialog .dialog-close,.nd-dialog-close",
  )) {
    if (item instanceof HTMLElement) item.click();
  }

  const meta = globalThis.metaData;
  const yun = globalThis.yunData || {};
  const locals = globalThis.locals;
  if (!meta?.file) throw new Error("分享页没有暴露文件元数据，无法拉起客户端下载。");

  const getLocal = (key) => {
    try {
      return locals?.get?.(key) ?? "";
    } catch {
      return "";
    }
  };
  const token = String(yun.bdstoken || getLocal("bdstoken") || "");
  const shareId = String(yun.shareid || getLocal("shareid") || "");
  const shareUk = String(yun.share_uk || getLocal("share_uk") || "");
  const file = meta.file;
  const expectedName = ${JSON.stringify(targetName)};
  const baseQuery =
    "channel=chunlei&web=1&app_id=250528&bdstoken=" +
    encodeURIComponent(token) +
    "&clienttype=0";

  const jsonFetch = async (url, init) => {
    const response = await fetch(url, { credentials: "include", ...init });
    const data = await response.json();
    return data;
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const compactJson = (value) => {
    try {
      return JSON.stringify(value).replace(/\\s+/g, " ").slice(0, 800);
    } catch {
      return String(value).slice(0, 800);
    }
  };
  const attempts = [];
  const rootPath = "/" + expectedName;
  const itemName = (item) => String(item?.server_filename || item?.path?.split("/")?.pop() || "");
  const isExactItem = (item) => itemName(item) === expectedName || item?.path === rootPath;
  const isLikelyNewCopy = (item) => {
    const name = itemName(item);
    return name === expectedName ||
      name.startsWith(expectedName + "(") ||
      name.startsWith(expectedName + "（") ||
      name.startsWith(expectedName + " - ") ||
      name.startsWith(expectedName + "_");
  };

  const searchOwnItem = async (allowCopyName = false) => {
    try {
      const data = await jsonFetch(
        "/api/search?recursion=1&key=" + encodeURIComponent(expectedName) + "&" + baseQuery,
      );
      if (data.errno !== 0) {
        attempts.push("search errno=" + data.errno + " " + compactJson(data));
        return undefined;
      }
      const list = Array.isArray(data.list) ? data.list : [];
      return list.find(isExactItem) || (allowCopyName ? list.find(isLikelyNewCopy) : undefined);
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
    const surl = location.pathname.split("/s/")[1] || "";
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
      fsidlist: JSON.stringify([file.fs_id]),
      path: "/",
    });
    const saved = await jsonFetch("/share/transfer?" + params.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    transferResponse = saved;
    if (saved.errno !== 0) {
      throw new Error("保存分享到网盘失败：" + JSON.stringify(saved));
    }

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
  if (!ownRoot) {
    throw new Error(
      "保存后没有在自有网盘中找到目标文件。transfer=" +
        compactJson(transferResponse || {}) +
        "；attempts=" +
        attempts.slice(-12).join(" | "),
    );
  }

  return {
    fileName: ownRoot.server_filename || expectedName,
    savedPath: ownRoot.path || "/" + (ownRoot.server_filename || expectedName),
    fsId: ownRoot.fs_id,
    alreadySaved,
    locateSource,
  };
})()
`,
      90000,
    );

    if (!result.savedPath) throw new Error("没有拿到保存后的网盘路径。");
    return result;
  });
}

function parentNetdiskPath(filePath: string) {
  const normalized = filePath.startsWith("/") ? filePath : `/${filePath}`;
  const withoutTrailingSlash = normalized.replace(/\/+$/g, "") || "/";
  const index = withoutTrailingSlash.lastIndexOf("/");
  return index > 0 ? withoutTrailingSlash.slice(0, index) : "/";
}

async function openOwnFileList(port: number, dirPath = "/") {
  const targets = await getTargets(port);
  const target =
    targets.find(
      (item) =>
        item.webSocketDebuggerUrl &&
        item.url.includes("core.asar") &&
        item.url.includes("#/?category=all"),
    ) ??
    targets.find(
      (item) =>
        item.webSocketDebuggerUrl &&
        item.url.includes("core.asar") &&
        item.url.includes("#/downloading"),
    ) ??
    targets.find((item) => item.webSocketDebuggerUrl && item.url.includes("core.asar"));

  if (!target) throw new Error("没有找到百度网盘客户端原生页面。");

  await withPage(target, async (page) => {
    await page.evaluate(
      `location.hash = "/?category=all&path=${encodeURIComponent(dirPath || "/")}"`,
    );
  });

  return waitForTarget(
    port,
    (item) =>
      item.url.includes("core.asar") &&
      item.url.includes("#/?category=all") &&
      item.url.includes("path="),
    15000,
  );
}

async function downloadOwnFolderFromClientPage(port: number, targetName: string, savedPath?: string) {
  const dirPath = savedPath ? parentNetdiskPath(savedPath) : "/";
  const target = await openOwnFileList(port, dirPath);
  await withPage(target, async (page) => {
    log(`从客户端文件列表下载目录：${savedPath || targetName}`);
    const selected = await page.evaluate<{ selected: boolean; text: string }>(
      `
(async () => {
  const wanted = ${JSON.stringify(targetName)};
  const bodyText = () => (document.body ? document.body.innerText : "");
  const normalizedText = (item) =>
    String(item?.innerText || item?.textContent || item?.getAttribute?.("title") || "")
      .replace(/\\s+/g, " ")
      .trim();
  const isSelected = (row) =>
    /已选中|已选择/.test(bodyText()) ||
    String(row?.className || "").includes("selected") ||
    String(row?.className || "").includes("active");
  const started = Date.now();
  while (Date.now() - started < 25000) {
    const row = [...document.querySelectorAll(".itemWrap,.fileItemWrapSearch,tr.u-table__row,dd,.vdAfKMb,.NHcGw")]
      .find((item) => {
        if (!(item instanceof HTMLElement)) return false;
        const filename = item.querySelector(".filename,[title]");
        const exactName =
          filename instanceof HTMLElement
            ? String(filename.getAttribute("title") || normalizedText(filename)).trim()
            : "";
        const text = normalizedText(item);
        return exactName === wanted || text.includes(wanted);
      });
    if (row instanceof HTMLElement) {
      if (!isSelected(row)) {
        const checkbox =
          row.querySelector(".u-checkbox,.checkbox,.file-select,[class*=checkbox],[class*=Checkbox]") ||
          row;
        const rect = checkbox instanceof HTMLElement
          ? checkbox.getBoundingClientRect()
          : row.getBoundingClientRect();
        for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
          (checkbox instanceof HTMLElement ? checkbox : row).dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: rect.x + 12,
            clientY: rect.y + rect.height / 2,
          }));
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { selected: isSelected(row), text: bodyText() };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { selected: false, text: bodyText() };
})()
`,
      30000,
    );
    if (!selected.selected) throw new Error("没有在客户端文件列表中选中目标目录。");

    log("点击客户端目录下载");
    const clicked = await page.evaluate<{ clicked: boolean; text: string }>(
      `
(() => {
  const button = document.querySelector(".downloadBtn,.bottom_download_btn");
  if (!(button instanceof HTMLElement)) {
    return { clicked: false, text: document.body ? document.body.innerText : "" };
  }
  const rect = button.getBoundingClientRect();
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    button.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2,
    }));
  }
  return { clicked: true, text: document.body ? document.body.innerText : "" };
})()
`,
      10000,
    );
    if (!clicked.clicked) throw new Error("没有找到客户端目录下载按钮。");
  });
}

async function findClientPage(port: number) {
  const targets = await getTargets(port);
  const target =
    targets.find(
      (item) =>
        item.webSocketDebuggerUrl &&
        item.url.includes("core.asar") &&
        item.url.includes("#/searchNew"),
    ) ??
    targets.find(
      (item) =>
        item.webSocketDebuggerUrl &&
        item.url.includes("core.asar") &&
        !item.url.includes("#/bubble_menu") &&
        !item.url.includes("#/workspace"),
    ) ??
    targets.find((item) => item.webSocketDebuggerUrl && item.url.includes("core.asar"));

  if (!target) throw new Error("没有找到百度网盘客户端页面。");
  return target;
}

async function downloadSavedFolderFromClientSearch(port: number, targetName: string) {
  const target = await findClientPage(port);
  await withPage(target, async (page) => {
    log(`客户端搜索并下载目录：${targetName}`);
    const result = await page.evaluate<{ clicked: boolean; href: string; text: string }>(
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
  while (Date.now() - started < 20000) {
    const rows = [...document.querySelectorAll(".fileItemWrapSearch,.itemWrap,tr.u-table__row,dd")];
    row = rows.find((item) => {
      if (!(item instanceof HTMLElement) || !isVisible(item)) return false;
      const filename = item.querySelector(".filename,[title]");
      const exactName =
        filename instanceof HTMLElement
          ? String(filename.getAttribute("title") || normalizedText(filename)).trim()
          : "";
      const text = normalizedText(item);
      return (exactName === wanted || text.includes(wanted)) && text.includes("文件夹");
    });
    if (row instanceof HTMLElement) break;
    await sleep(500);
  }

  if (!(row instanceof HTMLElement)) {
    return { clicked: false, href: location.href, text: bodyText() };
  }

  fireClick(row);
  await sleep(250);

  let button =
    row.querySelector(".download,[title='下载']") ||
    [...row.querySelectorAll("div,span,a,button")].find(
      (item) =>
        item instanceof HTMLElement &&
        isVisible(item) &&
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
        if (!(item instanceof HTMLElement) || !isVisible(item)) return false;
        const text = normalizedText(item);
        const title = String(item.getAttribute("title") || "");
        const className = String(item.className || "");
        if (/disabled|is-disabled/.test(className)) return false;
        return className.includes("downloadBtn") || className === "download" || text === "下载" || title === "下载";
      });
  }

  if (!(button instanceof HTMLElement)) {
    return { clicked: false, href: location.href, text: bodyText() };
  }

  fireClick(button);
  await sleep(500);
  return { clicked: true, href: location.href, text: bodyText() };
})()
`,
      30000,
    );

    if (!result.clicked) {
      throw new Error("没有在客户端搜索结果中触发目标目录下载。");
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

    for (let attempt = 0; attempt < 50; attempt++) {
      const state = await page.evaluate<{ rect?: Rect; text: string; downloadDirApplied: boolean }>(`
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
  const line = text
    .split(/\r?\n/)
    .find((item) => item.includes("下载到"));
  return line?.replace(/^.*下载到[:：]\s*/, "").trim();
}

async function waitForDownloadSubmitted(port: number) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    const targets = await getTargets(port);
    if (!targets.some((target) => target.url.includes("#/downloadingSetting"))) {
      log("下载任务已提交");
      return;
    }
    await sleep(500);
  }

  throw new Error("已点击确认下载，但下载设置窗口没有关闭。");
}

async function isCompletedInClient(port: number, targetName: string) {
  const targets = await getTargets(port);
  const transferTarget =
    targets.find(
      (target) =>
        target.webSocketDebuggerUrl &&
        target.url.includes("core.asar") &&
        target.url.includes("#/downloading"),
    ) ??
    targets.find(
      (target) =>
        target.webSocketDebuggerUrl &&
        target.url.includes("core.asar") &&
        target.url.includes("#/seston"),
    );

  if (!transferTarget) return false;

  const text = await withPage(transferTarget, (page) =>
    page.evaluate<string>(
      `
(async () => {
  const doneTab = [...document.querySelectorAll("div,span,a,button")]
    .find((item) => item instanceof HTMLElement && item.innerText.trim().startsWith("已完成"));
  if (doneTab instanceof HTMLElement) {
    const rect = doneTab.getBoundingClientRect();
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      doneTab.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.x + rect.width / 2,
        clientY: rect.y + rect.height / 2,
      }));
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return document.body ? document.body.innerText : "";
})()
`,
      15000,
    ),
  );

  return text.includes("已完成") && text.includes(targetName);
}

async function sharePageNeedsDownloadCaptcha(port: number, targetName: string) {
  const targets = await getTargets(port);
  const shareTargets = targets.filter(
    (target) => target.webSocketDebuggerUrl && target.url.includes("pan.baidu.com"),
  );

  for (const shareTarget of shareTargets) {
    const text = await withPage(shareTarget, (page) =>
      page.evaluate<string>('document.body ? document.body.innerText : ""', 10000),
    );
    if (text.includes("请输入验证码") && text.includes("下载")) return true;
  }

  return false;
}

function candidateDownloadRoots(rootFromDialog?: string, downloadDir = DEFAULT_BAIDU_NETDISK_DOWNLOAD_DIR) {
  const roots = [
    downloadDir,
    rootFromDialog,
    process.env.BAIDU_DOWNLOAD_DIR,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "Downloads") : undefined,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "BaiduNetdiskDownload") : undefined,
    "C:\\BaiduNetdiskDownload",
  ].filter((item): item is string => Boolean(item));

  return [...new Set(roots)];
}

async function findExistingDownloadPath(
  targetName: string,
  rootFromDialog?: string,
  downloadDir = DEFAULT_BAIDU_NETDISK_DOWNLOAD_DIR,
) {
  for (const root of candidateDownloadRoots(rootFromDialog, downloadDir)) {
    const candidate = path.join(root, targetName);
    if (await pathExists(candidate)) return candidate;
  }

  return undefined;
}

async function getDownloadStatus(targetPath: string): Promise<DownloadStatus> {
  if (!(await pathExists(targetPath))) {
    return { exists: false, files: 0, partials: 0, bytes: 0, latestWriteMs: 0 };
  }

  const rootStat = await stat(targetPath);
  if (rootStat.isFile()) {
    return {
      exists: true,
      files: 1,
      partials: isPartialName(path.basename(targetPath)) ? 1 : 0,
      bytes: rootStat.size,
      latestWriteMs: rootStat.mtimeMs,
    };
  }

  return walkDownload(targetPath);
}

async function walkDownload(root: string): Promise<DownloadStatus> {
  let files = 0;
  let partials = 0;
  let bytes = 0;
  let latestWriteMs = 0;
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      const fileStat = await stat(fullPath).catch(() => undefined);
      files++;
      if (isPartialName(entry.name)) partials++;
      if (fileStat) {
        bytes += fileStat.size;
        latestWriteMs = Math.max(latestWriteMs, fileStat.mtimeMs);
      }
    }
  }

  return { exists: true, files, partials, bytes, latestWriteMs };
}

function isPartialName(fileName: string) {
  const lower = fileName.toLowerCase();
  return (
    lower.includes(".downloading") ||
    lower.endsWith(".baiduyun.p.downloading") ||
    lower.endsWith(".bdtmp") ||
    lower.endsWith(".tmp")
  );
}

async function waitForLocalDownloadComplete(
  targetName: string,
  rootFromDialog?: string,
  timeoutMs = 60 * 60 * 1000,
  downloadDir = DEFAULT_BAIDU_NETDISK_DOWNLOAD_DIR,
) {
  const explicitPath = await findExistingDownloadPath(targetName, rootFromDialog, downloadDir);
  const targetPath =
    explicitPath ??
    path.join(candidateDownloadRoots(rootFromDialog, downloadDir)[0] ?? process.cwd(), targetName);

  if (timeoutMs <= 0) {
    log(`跳过完整下载等待：${targetPath}`);
    return targetPath;
  }

  log(`等待本地下载完成：${targetPath}`);
  const started = Date.now();
  let lastLog = 0;
  let stableChecks = 0;
  let previous: DownloadStatus | undefined;

  while (Date.now() - started < timeoutMs) {
    const status = await getDownloadStatus(targetPath);
    const stable =
      previous &&
      previous.exists === status.exists &&
      previous.files === status.files &&
      previous.partials === status.partials &&
      previous.bytes === status.bytes &&
      previous.latestWriteMs === status.latestWriteMs;

    if (status.exists && status.files > 0 && status.partials === 0) {
      stableChecks = stable ? stableChecks + 1 : 1;
      if (stableChecks >= 2) return targetPath;
    } else {
      stableChecks = 0;
    }

    if (Date.now() - lastLog > 5000) {
      log(
        `下载状态：files=${status.files}, downloading=${status.partials}, bytes=${status.bytes}`,
      );
      lastLog = Date.now();
    }

    previous = status;
    await sleep(3000);
  }

  const finalStatus = await getDownloadStatus(targetPath);
  throw new Error(
    `下载未在限定时间内完成：files=${finalStatus.files}, downloading=${finalStatus.partials}, path=${targetPath}`,
  );
}

async function submitDirectDownload(
  port: number,
  listTarget: CdpTarget,
  share: ShareInfo,
  downloadDir?: string,
) {
  await downloadShareFolderFromSharePage(listTarget, share.name);
  let downloadRoot: string | undefined;
  try {
    downloadRoot = await confirmDownloadSetting(port, downloadDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("没有找到目标页面")) {
      throw new Error(
        "分享页直接下载没有拉起客户端下载确认窗口，通常是验证码、风控或下载信息获取失败。请使用 --strategy=save。",
      );
    }
    throw error;
  }
  await waitForDownloadSubmitted(port);
  return downloadRoot;
}

async function submitSavedDownload(
  port: number,
  listTarget: CdpTarget,
  share: ShareInfo,
  downloadDir?: string,
) {
  const saved = await saveShareToOwnNetdisk(listTarget, share.name);
  log(
    saved.alreadySaved
      ? `网盘中已存在目录：${saved.savedPath} (${saved.locateSource})`
      : `已保存到网盘：${saved.savedPath} (${saved.locateSource})`,
  );

  try {
    await downloadOwnFolderFromClientPage(port, saved.fileName || share.name, saved.savedPath);
  } catch (error) {
    log(
      `客户端文件列表下载未触发，回退搜索页：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    await downloadSavedFolderFromClientSearch(port, saved.fileName || share.name);
  }
  const downloadRoot = await confirmDownloadSetting(port, downloadDir);
  await waitForDownloadSubmitted(port);
  return downloadRoot;
}

export async function downloadBaiduNetdiskShare(
  options: BaiduNetdiskShareDownloadOptions,
): Promise<BaiduNetdiskShareDownloadResult> {
  if (process.platform !== "win32") {
    throw new Error("当前脚本实现的是 Windows 百度网盘 CDP 下载流程。");
  }

  const port = options.port ?? 9337;
  const waitCompleteMs = options.waitCompleteMs ?? 60 * 60 * 1000;
  const downloadStrategy = options.strategy ?? "auto";
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

  await mkdir(downloadDir, { recursive: true });

  log(`读取分享：${share.name}`);
  log(`下载策略：${downloadStrategy}`);
  log(`默认下载目录：${downloadDir}`);

  const existingPath = await findExistingDownloadPath(share.name, undefined, downloadDir);
  if (existingPath && !options.forceClick) {
    const status = await getDownloadStatus(existingPath);
    if (status.files > 0) {
      log(`检测到已有本地下载目录：${existingPath}`);
      const localPath = await waitForLocalDownloadComplete(
        share.name,
        path.dirname(existingPath),
        waitCompleteMs,
        downloadDir,
      );
      return {
        share,
        downloadRoot: path.dirname(localPath),
        localPath,
        completed: true,
        skippedExisting: true,
      };
    }
  }

  await copyToClipboard(content);
  log("已复制分享内容到剪贴板");

  await ensureBaiduCdpPort(port);
  log(`使用百度网盘 CDP 端口：${port}`);

  const shareTarget = await openSharePage(port, share);
  await enterShareCode(shareTarget, share);
  const listTarget = await waitForShareList(port, share);

  let downloadRoot: string | undefined;
  if (downloadStrategy === "direct") {
    try {
      downloadRoot = await submitDirectDownload(port, listTarget, share, downloadDir);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("验证码") || (await sharePageNeedsDownloadCaptcha(port, share.name))) {
        throw new Error(
          "分享页直接下载要求验证码；脚本不会接入验证码破解或打码库。请改用 --strategy=save，或手动完成验证码后重试。",
        );
      }
      throw error;
    }
  } else if (downloadStrategy === "save") {
    downloadRoot = await submitSavedDownload(port, listTarget, share, downloadDir);
  } else {
    try {
      downloadRoot = await submitDirectDownload(port, listTarget, share, downloadDir);
    } catch (directError) {
      if (await isCompletedInClient(port, share.name)) {
        log("客户端已完成列表中存在目标文件");
        return { share, completed: true, skippedExisting: false };
      }

      log(
        `分享页直接下载未完成，尝试保存后从客户端下载：${
          directError instanceof Error ? directError.message : String(directError)
        }`,
      );

      try {
        downloadRoot = await submitSavedDownload(port, listTarget, share, downloadDir);
      } catch (saveError) {
        if (await isCompletedInClient(port, share.name)) {
          log("客户端已完成列表中存在目标文件");
          return { share, completed: true, skippedExisting: false };
        }

        if (await sharePageNeedsDownloadCaptcha(port, share.name)) {
          throw new Error(
            "检测到网页验证码；脚本不会绕过验证码。可先手动处理验证码，或使用保存到账号后下载策略。",
          );
        }

        throw new Error(
          `直接下载和保存后客户端下载都未完成。直接下载错误：${
            directError instanceof Error ? directError.message : String(directError)
          }；保存后下载错误：${
            saveError instanceof Error ? saveError.message : String(saveError)
          }`,
        );
      }
    }
  }

  if (!downloadRoot && (await isCompletedInClient(port, share.name))) {
    log("客户端已完成列表中存在目标文件");
    return { share, completed: true, skippedExisting: false };
  }

  if (!downloadRoot) {
    throw new Error(
      downloadStrategy === "direct"
        ? "直接下载未提交下载任务。"
        : "保存后下载未提交下载任务。",
    );
  }

  if (await isCompletedInClient(port, share.name)) {
    log("客户端已完成列表中存在目标文件");
    return { share, downloadRoot, completed: true, skippedExisting: false };
  }

  const predictedLocalPath = path.join(downloadRoot, share.name);
  if (waitCompleteMs <= 0) {
    log(`下载任务已提交，不等待本地完成：${predictedLocalPath}`);
    return {
      share,
      downloadRoot,
      localPath: predictedLocalPath,
      completed: false,
      skippedExisting: false,
    };
  }

  const localPath = await waitForLocalDownloadComplete(
    share.name,
    downloadRoot,
    waitCompleteMs,
    downloadDir,
  );

  return {
    share,
    downloadRoot: downloadRoot ?? path.dirname(localPath),
    localPath,
    completed: true,
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
