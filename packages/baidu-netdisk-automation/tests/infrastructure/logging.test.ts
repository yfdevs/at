import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  configureBaiduNetdiskAutomationLogging,
  flushBaiduNetdiskAutomationLogs,
  log,
} from "../../src/infrastructure/logging.js";

void test("writes package logs to the runtime path injected by the platform module", async () => {
  const testDir = await mkdtemp(path.join(tmpdir(), "baidu-netdisk-logging-"));
  const logFilePath = path.join(testDir, "configured-run-root", "baidu-netdisk", "logs", "app-test.log");

  try {
    configureBaiduNetdiskAutomationLogging({
      console: false,
      logFilePath,
    });
    log("日志目录注入测试", { source: "test" });
    await flushBaiduNetdiskAutomationLogs();

    const content = await readFile(logFilePath, "utf8");
    assert.match(content, /\[BAIDU_NETDISK:NETDISK\] 日志目录注入测试/);
    assert.match(content, /source=test/);
  } finally {
    await rm(testDir, { recursive: true, force: true });
  }
});
