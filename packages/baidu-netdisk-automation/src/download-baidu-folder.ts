import { spawn } from "node:child_process";
import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const shareFile = getArg("--share-file") ?? "baudi.txt";
const debugPort = numberArg("--port") ?? 9337;
const waitCompleteMs = numberArg("--wait-complete-ms") ?? 60 * 60 * 1000;
const forceClick = args.includes("--force-click");
const downloadStrategy = parseDownloadStrategy(
  getArg("--strategy") ?? getArg("--download-strategy") ?? "auto",
);
const debugHost = "127.0.0.1";
const requestTimeoutMs = 2500;

type DownloadStrategy = "auto" | "direct" | "save";

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

type ShareInfo = {
  link: string;
  pwd: string;
  name: string;
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

function getArg(name: string) {
  const equalArg = args.find((arg) => arg.startsWith(`${name}=`));
  if (equalArg) return equalArg.slice(name.length + 1);

  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return undefined;
}

function numberArg(name: string) {
  const value = getArg(name);
  if (!value) return undefined;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} 必须是数字。`);
  return parsed;
}

function parseDownloadStrategy(value: string): DownloadStrategy {
  if (value === "auto" || value === "direct" || value === "save") return value;
  throw new Error("--strategy 必须是 auto、direct 或 save。");
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

async function readShareInfo(): Promise<ShareInfo> {
  const fullPath = path.resolve(process.cwd(), shareFile);
  const content = await readFile(fullPath, "utf8");
  const link = content.match(/https?:\/\/pan\.baidu\.com\/s\/[^\s"'<>]+/)?.[0];
  if (!link) throw new Error(`${shareFile} 中没有找到百度网盘分享链接。`);

  const url = new URL(link);
  const pwd =
    url.searchParams.get("pwd") ??
    content.match(/(?:提取码|密码|pwd)[:：\s]*([a-zA-Z0-9]{4})/)?.[1];
  if (!pwd) throw new Error(`${shareFile} 中没有找到提取码。`);

  const name =
    content.match(/通过网盘分享的文件[:：]\s*([^\r\n]+)/)?.[1]?.trim() ??
    content.match(/分享的文件[:：]\s*([^\r\n]+)/)?.[1]?.trim() ??
    "百度网盘分享";

  return { link, pwd, name: sanitizeWindowsName(name) };
}

function sanitizeWindowsName(value: string) {
  const sanitized = value.replace(/[\\/:*?"<>|]/g, "_").trim();
  return sanitized || "百度网盘分享";
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
    this.socket.addEventListener("close", () => {
      this.closed = true;
    });
  }

  async open() {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("CDP WebSocket 连接超时。")), 10000);
      this.socket.addEventListener(
        "open",
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
      this.socket.addEventListener(
        "error",
        () => {
          clearTimeout(timeout);
          reject(new Error("CDP WebSocket 连接失败。"));
        },
        { once: true },
      );
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
        this.socket.removeEventListener("message", onMessage);
        this.socket.removeEventListener("close", onClose);
      };
      const onClose = () => {
        cleanup();
        reject(new Error("CDP 页面已关闭。"));
      };
      const onMessage = (event: MessageEvent) => {
        const message = JSON.parse(String(event.data)) as CdpMessage;
        if (message.id !== id) return;

        cleanup();
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result as T);
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`${method} 超时。`));
      }, timeoutMs);

      this.socket.addEventListener("message", onMessage);
      this.socket.addEventListener("close", onClose);
      this.socket.send(JSON.stringify({ id, method, params }));
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

  async navigate(url: string) {
    await this.send("Page.navigate", { url }, 15000);
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

async function openSharePage(port: number, share: ShareInfo) {
  const id = shareId(share.link);
  const targets = await getTargets(port);
  const existing = targets.find(
    (target) =>
      target.webSocketDebuggerUrl &&
      target.url.includes("pan.baidu.com") &&
      (target.url.includes(id) || target.url.includes(encodeURIComponent(id))),
  );
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
  await withPage(reusable, async (page) => {
    await page.navigate(share.link);
  });

  return waitForTarget(
    port,
    (target) =>
      target.url.includes("pan.baidu.com") &&
      (target.url.includes(id) || target.url.includes("share/init")),
    20000,
  );
}

async function enterShareCode(target: CdpTarget, pwd: string) {
  await withPage(target, async (page) => {
    await waitForDocumentBody(page);

    const state = await page.evaluate<{ url: string; text: string }>(
      `({ url: location.href, text: document.body ? document.body.innerText : "" })`,
    );

    if (!state.url.includes("share/init")) return;

    log("输入提取码并提取文件");
    const clicked = await page.evaluate<{ clicked: boolean; url: string; text: string }>(`
(async () => {
  const text = () => (document.body ? document.body.innerText : "");
  const started = Date.now();

  while (Date.now() - started < 15000) {
    if (!location.href.includes("share/init")) {
      return { clicked: true, url: location.href, text: text() };
    }

    const input = document.querySelector("#accessCode");
    const button = document.querySelector("#submitBtn");
    if (input instanceof HTMLInputElement && button instanceof HTMLElement) {
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, ${JSON.stringify(pwd)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));

      button.scrollIntoView({ block: "center", inline: "center" });
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
      return { clicked: true, url: location.href, text: text() };
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return { clicked: false, url: location.href, text: text() };
})()
`);
    if (!clicked.clicked) throw new Error("没有找到提取文件按钮。");
  });
}

async function waitForShareList(port: number, share: ShareInfo) {
  const id = shareId(share.link);
  const started = Date.now();
  while (Date.now() - started < 30000) {
    const targets = await getTargets(port);
    const target = targets.find(
      (item) =>
        item.webSocketDebuggerUrl &&
        item.url.includes("pan.baidu.com") &&
        (item.url.includes(id) || item.url.includes("share/init")),
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

  const exactOwnItem = async () => {
    const data = await jsonFetch(
      "/api/search?recursion=1&key=" + encodeURIComponent(expectedName) + "&" + baseQuery,
    );
    if (data.errno !== 0) {
      throw new Error("搜索自有网盘失败：" + JSON.stringify(data));
    }
    return (data.list || []).find(
      (item) => item.server_filename === expectedName || item.path === "/" + expectedName,
    );
  };

  let ownRoot = await exactOwnItem();
  let alreadySaved = Boolean(ownRoot);
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
    if (saved.errno !== 0) {
      throw new Error("保存分享到网盘失败：" + JSON.stringify(saved));
    }
    ownRoot = await exactOwnItem();
  }
  if (!ownRoot) throw new Error("保存后没有在自有网盘中找到目标文件。");

  return {
    fileName: ownRoot.server_filename || expectedName,
    savedPath: ownRoot.path,
    fsId: ownRoot.fs_id,
    alreadySaved,
  };
})()
`,
      30000,
    );

    if (!result.savedPath) throw new Error("没有拿到保存后的网盘路径。");
    return result;
  });
}

async function openOwnFileList(port: number) {
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
    await page.evaluate(`location.hash = "/?category=all&path=%2F"`);
  });

  return waitForTarget(
    port,
    (item) =>
      item.url.includes("core.asar") &&
      item.url.includes("#/?category=all") &&
      (item.url.includes("path=%2F") || item.url.includes("path=")),
    15000,
  );
}

async function downloadOwnFolderFromClientPage(port: number, targetName: string) {
  const target = await openOwnFileList(port);
  await withPage(target, async (page) => {
    log(`选择客户端目录：${targetName}`);
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
  while (Date.now() - started < 15000) {
    const row = [...document.querySelectorAll(".itemWrap,.fileItemWrapSearch,tr.u-table__row,dd,.vdAfKMb,.NHcGw")]
      .find((item) => item instanceof HTMLElement && normalizedText(item).includes(wanted));
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
      20000,
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

async function confirmDownloadSetting(port: number) {
  const settingTarget = await waitForTarget(
    port,
    (target) => target.url.includes("#/downloadingSetting"),
    20000,
  );

  return withPage(settingTarget, async (page) => {
    let rect: Rect | undefined;
    let downloadRoot: string | undefined;

    for (let attempt = 0; attempt < 50; attempt++) {
      const state = await page.evaluate<{ rect?: Rect; text: string }>(`
(() => {
  const button = document.querySelector(".down-btn");
  const rect = button instanceof HTMLElement ? button.getBoundingClientRect() : undefined;
  return {
    text: document.body ? document.body.innerText : "",
    rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined,
  };
})()
`);
      downloadRoot = parseDownloadRoot(state.text) ?? downloadRoot;
      rect = state.rect ?? rect;
      if (rect) break;
      await sleep(100);
    }

    if (!rect) throw new Error("没有找到确认下载按钮。");
    log(downloadRoot ? `确认下载路径：${downloadRoot}` : "确认下载路径");
    await page.clickPoint(rect.x + rect.width / 2, rect.y + rect.height / 2, true);
    return downloadRoot;
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

function candidateDownloadRoots(rootFromDialog?: string) {
  const roots = [
    rootFromDialog,
    process.env.BAIDU_DOWNLOAD_DIR,
    "D:\\BaiduNetdiskDownload",
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "Downloads") : undefined,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "BaiduNetdiskDownload") : undefined,
    "C:\\BaiduNetdiskDownload",
  ].filter((item): item is string => Boolean(item));

  return [...new Set(roots)];
}

async function findExistingDownloadPath(targetName: string, rootFromDialog?: string) {
  for (const root of candidateDownloadRoots(rootFromDialog)) {
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
  timeoutMs = waitCompleteMs,
) {
  const explicitPath = await findExistingDownloadPath(targetName, rootFromDialog);
  const targetPath =
    explicitPath ??
    path.join(candidateDownloadRoots(rootFromDialog)[0] ?? process.cwd(), targetName);

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

async function submitDirectDownload(port: number, listTarget: CdpTarget, share: ShareInfo) {
  await downloadShareFolderFromSharePage(listTarget, share.name);
  let downloadRoot: string | undefined;
  try {
    downloadRoot = await confirmDownloadSetting(port);
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

async function submitSavedDownload(port: number, listTarget: CdpTarget, share: ShareInfo) {
  const saved = await saveShareToOwnNetdisk(listTarget, share.name);
  log(
    saved.alreadySaved
      ? `网盘中已存在目录：${saved.savedPath}`
      : `已保存到网盘：${saved.savedPath}`,
  );

  await downloadSavedFolderFromClientSearch(port, saved.fileName || share.name);
  const downloadRoot = await confirmDownloadSetting(port);
  await waitForDownloadSubmitted(port);
  return downloadRoot;
}

async function main() {
  if (process.platform !== "win32") {
    throw new Error("当前脚本实现的是 Windows 百度网盘 CDP 下载流程。");
  }

  const share = await readShareInfo();
  log(`读取分享：${share.name}`);
  log(`下载策略：${downloadStrategy}`);

  const existingPath = await findExistingDownloadPath(share.name);
  if (existingPath && !forceClick) {
    const status = await getDownloadStatus(existingPath);
    if (status.files > 0) {
      log(`检测到已有本地下载目录：${existingPath}`);
      await waitForLocalDownloadComplete(share.name, path.dirname(existingPath));
      console.log("成功");
      return;
    }
  }

  await copyToClipboard(await readFile(path.resolve(process.cwd(), shareFile), "utf8"));
  log("已复制分享内容到剪贴板");

  const port = debugPort;
  await ensureBaiduCdpPort(port);
  log(`使用百度网盘 CDP 端口：${port}`);

  const shareTarget = await openSharePage(port, share);
  await enterShareCode(shareTarget, share.pwd);
  const listTarget = await waitForShareList(port, share);

  let downloadRoot: string | undefined;
  if (downloadStrategy === "direct") {
    try {
      downloadRoot = await submitDirectDownload(port, listTarget, share);
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
    downloadRoot = await submitSavedDownload(port, listTarget, share);
  } else {
    try {
      downloadRoot = await submitDirectDownload(port, listTarget, share);
    } catch (directError) {
      if (await isCompletedInClient(port, share.name)) {
        log("客户端已完成列表中存在目标文件");
        console.log("成功");
        return;
      }

      log(
        `分享页直接下载未完成，尝试保存后从客户端下载：${
          directError instanceof Error ? directError.message : String(directError)
        }`,
      );

      try {
        downloadRoot = await submitSavedDownload(port, listTarget, share);
      } catch (saveError) {
        if (await isCompletedInClient(port, share.name)) {
          log("客户端已完成列表中存在目标文件");
          console.log("成功");
          return;
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
    console.log("成功");
    return;
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
    console.log("成功");
    return;
  }

  await waitForLocalDownloadComplete(share.name, downloadRoot);
  console.log("成功");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
