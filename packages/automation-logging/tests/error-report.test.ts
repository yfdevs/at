import assert from "node:assert/strict";
import test from "node:test";

import { formatAutomationErrorReport } from "../src/index.js";

test("formats nested iQiyi AI cover failures with the real cause", () => {
  const cause = new Error(
    "IQIYI_DRAMA_AI_COVER_TEXT_VALIDATION_FAILED: 剧名不准确；检测到剧名以外的文字",
  );
  const error = Object.assign(new Error("IQIYI_DRAMA_AI_COVER_GENERATION_FAILED"), { cause });

  assert.equal(
    formatAutomationErrorReport(error),
    "爱奇艺 AI 横版封面生成失败；根因：AI 横版封面文字验收未通过：剧名不准确；检测到剧名以外的文字" +
      "（错误码：IQIYI_DRAMA_AI_COVER_GENERATION_FAILED → IQIYI_DRAMA_AI_COVER_TEXT_VALIDATION_FAILED）",
  );
});

test("turns an AI provider HTTP error into an actionable Chinese report", () => {
  const cause = new Error("DRAMA_AI_IMAGE_GENERATION_FAILED: HTTP 401; invalid api key");
  const error = Object.assign(new Error("IQIYI_DRAMA_AI_COVER_GENERATION_FAILED"), { cause });

  assert.equal(
    formatAutomationErrorReport(error),
    "爱奇艺 AI 横版封面生成失败；根因：AI 图片生成服务调用失败：服务鉴权失败（HTTP 401），请检查 API Key" +
      "（错误码：IQIYI_DRAMA_AI_COVER_GENERATION_FAILED → DRAMA_AI_IMAGE_GENERATION_FAILED）",
  );
});

test("formats common Playwright timeouts and removes call logs", () => {
  assert.equal(
    formatAutomationErrorReport(
      "locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for getByRole('button')",
    ),
    "页面或服务响应超时（等待 30 秒），请检查网络和当前页面后重试",
  );
});

test("keeps an existing Chinese error detail and appends its diagnostic code", () => {
  assert.equal(
    formatAutomationErrorReport("IQIYI_DRAMA_FORM_INVALID: 演员姓名不能为空"),
    "爱奇艺提交表单校验未通过：演员姓名不能为空（错误码：IQIYI_DRAMA_FORM_INVALID）",
  );
});

test("explains a Baidu cover upload that never becomes confirmable", () => {
  const report = formatAutomationErrorReport(
    'BAIDU_DRAMA_COVER_CONFIRM_NOT_READY: file=cover.jpg dialog="本地图片 0张上传成功 去编辑 确认"',
  );
  assert.match(report, /^百度封面上传未完成，图片选择后仍显示 0 张上传成功/);
  assert.match(report, /错误码：BAIDU_DRAMA_COVER_CONFIRM_NOT_READY/);
});

test("removes unknown internal prefixes and remains stable when formatted twice", () => {
  const formatted = formatAutomationErrorReport("[local-video-invalid] 第 3 集视频不存在");
  assert.equal(formatted, "任务执行失败：第 3 集视频不存在（错误码：local-video-invalid）");
  assert.equal(formatAutomationErrorReport(formatted), formatted);
});
