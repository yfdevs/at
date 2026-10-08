import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyDouyinDramaFailStage,
} from "../../src/app/runtime.js";

test("maps netdisk and download failures to a backend-supported fail stage", () => {
  assert.equal(
    classifyDouyinDramaFailStage(new Error("DOUYIN_DRAMA_NETDISK_TEXT_REQUIRED")),
    "UPLOAD_FILE",
  );
  assert.equal(
    classifyDouyinDramaFailStage(new Error("百度网盘下载失败")),
    "UPLOAD_FILE",
  );
});

test("maps AI-generated role image failures to the upload stage", () => {
  assert.equal(
    classifyDouyinDramaFailStage(new Error("DOUYIN_DRAMA_AI_ROLE_IMAGE_GENERATION_FAILED")),
    "UPLOAD_FILE",
  );
});
