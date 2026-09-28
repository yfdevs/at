import assert from "node:assert/strict";
import test from "node:test";

import { summarizeTaobaoUploadText } from "../../src/automation/form-controls.js";
import { isTaobaoVideoInputCandidate } from "../../src/automation/episodes.js";

test("summarizes Taobao upload progress from visible page text", () => {
  assert.deepEqual(
    summarizeTaobaoUploadText("第1集.mp4 正在上传 42% 第2集.mp4 排队中", [
      "D:\\episodes\\第1集.mp4",
      "D:\\episodes\\第2集.mp4",
    ]),
    { matchedFileCount: 2, completedFileCount: 0, pending: true, failed: false, complete: false, progressText: "42%" },
  );
  assert.deepEqual(
    summarizeTaobaoUploadText("第1集.mp4 上传完成 第2集.mp4 上传完成 100%", [
      "D:\\episodes\\第1集.mp4",
      "D:\\episodes\\第2集.mp4",
    ]),
    { matchedFileCount: 2, completedFileCount: 2, pending: false, failed: false, complete: true, progressText: "100%" },
  );
  assert.equal(summarizeTaobaoUploadText("10 / 10", []).complete, true);
  assert.equal(summarizeTaobaoUploadText("上传失败，请重新上传", []).failed, true);
  assert.equal(summarizeTaobaoUploadText(
    "第1集.mp4 100% 第2集.mp4 等待上传",
    ["第1集.mp4", "第2集.mp4"],
  ).complete, false);
  assert.equal(summarizeTaobaoUploadText(
    "第1集.mp4 上传完成 第2集.mp4 等待上传 总进度 1 / 1",
    ["第1集.mp4", "第2集.mp4"],
  ).complete, false);
  assert.equal(summarizeTaobaoUploadText(
    "第1集.mp4 上传完成 第2集.mp4 转码失败",
    ["第1集.mp4", "第2集.mp4"],
  ).failed, true);
});

test("distinguishes the episode video input from the collection image uploader", () => {
  assert.equal(isTaobaoVideoInputCandidate({
    accept: "image/jpeg,image/png",
    multiple: true,
    nearby: "上传封面图片",
  }), false);
  assert.equal(isTaobaoVideoInputCandidate({
    accept: "video/mp4",
    multiple: true,
    nearby: "选择文件",
  }), true);
  assert.equal(isTaobaoVideoInputCandidate({
    accept: "",
    multiple: true,
    nearby: "批量上传剧集",
  }), true);
});
