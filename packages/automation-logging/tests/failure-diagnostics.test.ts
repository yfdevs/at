import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  captureAutomationFailureDiagnostics,
  cleanupAutomationFailureDiagnostics,
} from "../src/index.js";

test("saves a screenshot and a structured error record in the same failure directory", async () => {
  const runDataDir = await mkdtemp(path.join(tmpdir(), "automation-failure-"));
  try {
    const result = await captureAutomationFailureDiagnostics({
      platform: "baidu-drama",
      runDataDir,
      error: new Error("BAIDU_DRAMA_COVER_CONFIRM_NOT_READY: dialog=0张上传成功"),
      stage: "UPLOAD_FILE",
      task: { accountTaskId: 42, title: "测试短剧" },
      page: {
        isClosed: () => false,
        url: () => "https://example.test/create",
        title: async () => "创建短剧",
        screenshot: async ({ path: screenshotPath }) => {
          await writeFile(screenshotPath, "png", "utf8");
        },
      },
    });

    assert.ok(result);
    assert.equal(path.dirname(result.recordFile), result.directory);
    assert.equal(path.dirname(result.screenshotFile!), result.directory);
    assert.equal((await stat(result.screenshotFile!)).isFile(), true);
    const record = JSON.parse(await readFile(result.recordFile, "utf8"));
    assert.equal(record.platform, "baidu-drama");
    assert.equal(record.stage, "UPLOAD_FILE");
    assert.equal(record.task.accountTaskId, 42);
    assert.equal(record.screenshot.status, "saved");
    assert.match(record.error.report, /百度封面上传未完成/);
  } finally {
    await rm(runDataDir, { recursive: true, force: true });
  }
});

test("removes expired failure directories but preserves recent ones", async () => {
  const runDataDir = await mkdtemp(path.join(tmpdir(), "automation-failure-cleanup-"));
  try {
    const oldDirectory = path.join(runDataDir, "failures", "2020-01-01", "000000000-task");
    const recentDirectory = path.join(
      runDataDir,
      "failures",
      new Date().toISOString().slice(0, 10),
      "000000000-task",
    );
    await mkdir(oldDirectory, { recursive: true });
    await mkdir(recentDirectory, { recursive: true });
    const oldTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1_000);
    await utimes(oldDirectory, oldTime, oldTime);

    await cleanupAutomationFailureDiagnostics({
      platform: "test-platform",
      runDataDir,
      retentionDays: 7,
    });

    await assert.rejects(stat(oldDirectory));
    assert.equal((await stat(recentDirectory)).isDirectory(), true);
  } finally {
    await rm(runDataDir, { recursive: true, force: true });
  }
});

test("still writes the error record when no live page is available", async () => {
  const runDataDir = await mkdtemp(path.join(tmpdir(), "automation-failure-no-page-"));
  try {
    const result = await captureAutomationFailureDiagnostics({
      platform: "pinduoduo-drama",
      runDataDir,
      error: new Error("resource preparation failed"),
      task: { accountTaskId: 99 },
    });

    assert.ok(result);
    assert.equal(result.screenshotFile, undefined);
    const record = JSON.parse(await readFile(result.recordFile, "utf8"));
    assert.equal(record.screenshot.status, "unavailable");
    assert.match(record.screenshot.error, /页面已关闭或不可用/);
  } finally {
    await rm(runDataDir, { recursive: true, force: true });
  }
});
