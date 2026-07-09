import WebSocket from "ws";

import { debugHost } from "./constants.js";
import type { CdpMessage, CdpTarget } from "./types.js";
import { getJson, sleep, websocketDataToString } from "./utils.js";

export async function getTargets(port: number) {
  return getJson<CdpTarget[]>(`http://${debugHost}:${port}/json/list`);
}

async function isBaiduCdpPort(port: number) {
  try {
    const version = await getJson<{ "User-Agent"?: string }>(
      `http://${debugHost}:${port}/json/version`,
    );
    const targets = await getTargets(port);
    const userAgent = version["User-Agent"] ?? "";
    const hasBaiduTarget = targets.some(
      (target) =>
        target.url.includes("BaiduNetdisk") ||
        target.url.includes("core.asar") ||
        target.url.includes("pan.baidu.com"),
    );
    return /baidunetdisk/i.test(userAgent) || hasBaiduTarget;
  } catch {
    return false;
  }
}

export async function ensureBaiduCdpPort(port: number) {
  if (await isBaiduCdpPort(port)) return;
  throw new Error(
    `端口 ${port} 不是可用百度网盘 CDP。请先退出百度网盘，再手动启动 module\\BrowserEngine\\BaiduNetdiskUnite.exe --remote-debugging-port=${port}。`,
  );
}

export class CdpPage {
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
      // oxlint-disable-next-line prefer-const
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

  async send<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 15000) {
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

export async function withPage<T>(target: CdpTarget, run: (page: CdpPage) => Promise<T>) {
  if (!target.webSocketDebuggerUrl) throw new Error("目标页面没有 WebSocket 调试地址。");

  const page = new CdpPage(target.webSocketDebuggerUrl);
  await page.open();
  try {
    return await run(page);
  } finally {
    page.close();
  }
}

export async function waitForDocumentBody(page: CdpPage, timeoutMs = 15000) {
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

export async function waitForTarget(
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
