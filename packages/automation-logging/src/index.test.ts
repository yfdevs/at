import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createAutomationLogger } from "./index.js";

test("平台日志独立写入并统一格式", async () => {
  const testDir = await mkdtemp(path.join(tmpdir(), "automation-logging-"));
  try {
    const qqFile = path.join(testDir, "qq", "app-2026-08-28.log");
    const kuaishouFile = path.join(testDir, "kuaishou", "app-2026-08-28.log");
    const qqLogger = createAutomationLogger({
      platform: "qq-drama",
      scope: "task",
      logFilePath: qqFile,
      console: false,
    });
    const kuaishouLogger = createAutomationLogger({
      platform: "kuaishou-drama",
      scope: "upload",
      logFilePath: kuaishouFile,
      console: false,
    });

    qqLogger.info("[qq-drama] claimed task: 隔离测试", { taskId: 101, apiToken: "secret-value" });
    kuaishouLogger.info("[kuaishou-drama] video upload finished", { fileCount: 3 });
    await Promise.all([qqLogger.flush(), kuaishouLogger.flush()]);

    const qqText = await readFile(qqFile, "utf8");
    const kuaishouText = await readFile(kuaishouFile, "utf8");
    const qqStructured = await readFile(
      path.join(testDir, "qq", "structured", "app-2026-08-28.jsonl"),
      "utf8",
    );

    assert.match(qqText, /\[Drama\] \d+ - .+\s+LOG \[QQ_DRAMA:TASK\] claimed task: 隔离测试/);
    assert.match(qqText, /apiToken=\[REDACTED\]/);
    assert.doesNotMatch(qqText, /KUAISHOU_DRAMA|video upload finished/);
    assert.match(kuaishouText, /\s+LOG \[KUAISHOU_DRAMA:UPLOAD\] video upload finished/);
    assert.doesNotMatch(kuaishouText, /QQ_DRAMA|隔离测试/);
    assert.equal(JSON.parse(qqStructured).details.apiToken, "[REDACTED]");
  } finally {
    await rm(testDir, { recursive: true, force: true });
  }
});

test("日志回调异常不影响文件写入", async () => {
  const testDir = await mkdtemp(path.join(tmpdir(), "automation-logging-"));
  try {
    const logFile = path.join(testDir, "app-2026-08-28.log");
    const logger = createAutomationLogger({
      platform: "wechat-drama",
      scope: "runtime",
      logFilePath: logFile,
      console: false,
      onEntry: () => {
        throw new Error("sink unavailable");
      },
    });

    assert.doesNotThrow(() => logger.info("runtime stopped"));
    await logger.flush();
    assert.match(await readFile(logFile, "utf8"), /\s+LOG \[WECHAT_DRAMA:RUNTIME\] runtime stopped/);
  } finally {
    await rm(testDir, { recursive: true, force: true });
  }
});
