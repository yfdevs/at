import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { Page } from "playwright";

import { monitorEpisodeVodUploads } from "../../../src/automation/upload/vod-monitor.js";

test("closing the upload page interrupts monitoring immediately", async () => {
  const events = new EventEmitter();
  const page = events as unknown as Page;
  const monitoring = monitorEpisodeVodUploads(
    page,
    1,
    async () => undefined,
    60_000,
    { writeReport: false },
  );

  events.emit("close");

  await assert.rejects(monitoring, /上传页面或浏览器已关闭/);
});

test("an aborted upload signal prevents monitoring from starting", async () => {
  const controller = new AbortController();
  controller.abort(new Error("用户已终止当前任务。"));

  await assert.rejects(
    monitorEpisodeVodUploads(
      new EventEmitter() as unknown as Page,
      1,
      async () => undefined,
      60_000,
      { signal: controller.signal },
    ),
    /用户已终止当前任务/,
  );
});
