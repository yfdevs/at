import assert from "node:assert/strict";
import test from "node:test";
import { taobaoEpisodeBatchRanges } from "../../src/shared/constants.js";

import {
  advanceTaobaoDropdownSearchState,
  isTaobaoUploadReady,
  isTaobaoVideoInputCandidate,
  normalizeTaobaoDropdownText,
  scoreTaobaoContentTagMatch,
  summarizeTaobaoBatchItems,
  summarizeTaobaoUploadText,
  TAOBAO_DROPDOWN_END_SETTLE_MS,
  TAOBAO_DROPDOWN_SEARCH_TIMEOUT_MS,
  TAOBAO_MAX_FILES_PER_SELECTION,
  TAOBAO_PUBLISH_PRECLICK_MAX_MS,
  TAOBAO_PUBLISH_PRECLICK_MIN_MS,
} from "../../src/automation/episodes.js";

test("selects the complete Taobao task in one upload operation", () => {
  assert.equal(TAOBAO_MAX_FILES_PER_SELECTION, 100);
});

test("splits a Taobao task over 100 episodes into sequential publish batches", () => {
  assert.deepEqual(taobaoEpisodeBatchRanges(235), [
    { start: 1, end: 100 },
    { start: 101, end: 200 },
    { start: 201, end: 235 },
  ]);
});

test("never treats a partial 20-item Taobao queue as a complete larger task", () => {
  assert.equal(isTaobaoUploadReady({
    uploadEvidence: true,
    pending: false,
    buttonReady: true,
    matchedFileCount: 20,
    expectedFileCount: 78,
  }), false);
  assert.equal(isTaobaoUploadReady({
    uploadEvidence: true,
    pending: false,
    buttonReady: true,
    matchedFileCount: 78,
    expectedFileCount: 78,
  }), true);
});

test("paces the final Taobao publish action more slowly than normal form actions", () => {
  assert.equal(TAOBAO_PUBLISH_PRECLICK_MIN_MS, 4_000);
  assert.equal(TAOBAO_PUBLISH_PRECLICK_MAX_MS, 6_000);
});

test("recognizes Taobao batch items whose status is already uploaded", () => {
  assert.deepEqual(
    summarizeTaobaoBatchItems([
      { title: "烟火里的圆满 - 第1集.mp4", status: "已上传" },
      { title: "烟火里的圆满 - 第2集.mp4", status: "已上传" },
    ], [
      "D:\\episodes\\烟火里的圆满 - 第1集.mp4",
      "D:\\episodes\\烟火里的圆满 - 第2集.mp4",
    ]),
    { matchedFileCount: 2, completedFileCount: 2, failed: false, complete: true },
  );
});

test("matches Taobao content tags case-insensitively with an approximate fallback", () => {
  assert.equal(scoreTaobaoContentTagMatch("# ai 短剧", "AI短剧"), 1);
  assert.ok(scoreTaobaoContentTagMatch("# 都市情感AI仿真人短剧", "都市") >= 0.45);
  assert.ok(scoreTaobaoContentTagMatch("# AI仿真人短剧", "AI短剧") >= 0.45);
  assert.ok(scoreTaobaoContentTagMatch("# 农村美食", "AI短剧") < 0.45);
});

test("normalizes collection option whitespace before matching", () => {
  assert.equal(
    normalizeTaobaoDropdownText("   十八年归零，离婚后我靠辣酱翻身 "),
    "十八年归零，离婚后我靠辣酱翻身",
  );
  assert.equal(normalizeTaobaoDropdownText("第 12 集"), "第12集");
});

test("waits for a stable true end while a virtual collection list loads more options", () => {
  let state = advanceTaobaoDropdownSearchState({}, {
    atEnd: true,
    moved: false,
    loading: false,
    signature: "1000:300:合集1",
  }, 1_000, 2_000);
  assert.equal(state.shouldStop, false);

  state = advanceTaobaoDropdownSearchState(state.state, {
    atEnd: true,
    moved: false,
    loading: true,
    signature: "1000:300:合集1",
  }, 2_000, 2_000);
  assert.equal(state.shouldStop, false);

  state = advanceTaobaoDropdownSearchState(state.state, {
    atEnd: false,
    moved: true,
    loading: false,
    signature: "1800:300:合集8\u0001合集9",
  }, 3_000, 2_000);
  assert.equal(state.shouldStop, false);
  assert.equal(state.state.stableAtEndSince, undefined);

  state = advanceTaobaoDropdownSearchState(state.state, {
    atEnd: true,
    moved: false,
    loading: false,
    signature: "1800:300:合集8\u0001合集9",
  }, 4_000, 2_000);
  assert.equal(state.shouldStop, false);

  state = advanceTaobaoDropdownSearchState(state.state, {
    atEnd: true,
    moved: false,
    loading: false,
    signature: "1800:300:合集8\u0001合集9",
  }, 6_000, 2_000);
  assert.equal(state.shouldStop, true);
});

test("gives collection virtual scrolling enough time without waiting forever", () => {
  assert.equal(TAOBAO_DROPDOWN_END_SETTLE_MS, 8_000);
  assert.equal(TAOBAO_DROPDOWN_SEARCH_TIMEOUT_MS, 120_000);
});

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
