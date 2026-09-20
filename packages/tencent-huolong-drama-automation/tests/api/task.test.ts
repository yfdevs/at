// oxlint-disable typescript/no-floating-promises
import assert from "node:assert/strict";
import test from "node:test";

import type { TencentHuolongHttpClient } from "../../src/api/http-client.js";
import {
  claimNextTencentHuolongDramaTaskApi,
  reportTencentHuolongDramaTaskErrorApi,
  reportTencentHuolongDramaTaskSuccessApi,
} from "../../src/api/task.js";
import { createTencentHuolongTaskFixture } from "../fixtures/task-fixture.js";

test("lists and claims a Tencent Huolong task through the real API contract", async () => {
  const fixture = createTencentHuolongTaskFixture();
  const calls: Array<{ path: string; payload: unknown }> = [];
  const client: TencentHuolongHttpClient = {
    async post(path, payload) {
      calls.push({ path, payload });
      if (path.endsWith("/accountTask/page")) {
        return {
          code: 0,
          msg: "操作成功",
          data: {
            total: 1,
            data: [{
              id: fixture.accountTaskId,
              dramaId: fixture.dramaId,
              accountId: fixture.accountId,
              accountName: fixture.accountName,
              status: "READY",
              originalTitle: fixture.originalTitle,
            }],
          },
        } as never;
      }
      if (path.endsWith("/rpa/claim")) {
        return {
          code: 0,
          msg: "操作成功",
          data: {
            accountTaskId: fixture.accountTaskId,
            accountId: fixture.accountId,
            originalTitle: fixture.originalTitle,
            payloadJson: {
              name: fixture.playlet.title,
              summary: fixture.playlet.summary,
              episodeCount: fixture.playlet.episodeCount,
              baiduPanResourceLink: fixture.playlet.baiduPanResourceLink,
              productionCost: { proofFiles: fixture.playlet.costAnalysisFiles },
              copyright: {
                productionProofFiles: fixture.playlet.copyrightProofFiles,
              },
              production: { processFiles: fixture.playlet.productionProcessFiles },
              tencentHuolongPlaylet: {
                protagonistName: fixture.playlet.protagonistName,
                isAiRealPersonShortDrama: false,
                themeType: fixture.playlet.themeType,
                keywords: fixture.playlet.keywords,
              },
            },
          },
        } as never;
      }
      throw new Error(`unexpected path: ${path}`);
    },
  };

  const task = await claimNextTencentHuolongDramaTaskApi({
    client,
    runtimeOptions: {
      accountId: fixture.accountId,
      accountName: fixture.accountName,
    },
  });

  assert.ok(task);
  assert.equal(task.accountTaskId, fixture.accountTaskId);
  assert.equal(task.dramaId, fixture.dramaId);
  assert.equal(task.accountId, fixture.accountId);
  assert.equal(task.playlet.isAiRealPersonShortDrama, "否");
  assert.deepEqual(task.playlet.keywords, ["都市", "情感"]);
  assert.deepEqual(task.playlet.costAnalysisFiles, fixture.playlet.costAnalysisFiles);
  assert.deepEqual(task.playlet.copyrightProofFiles, fixture.playlet.copyrightProofFiles);
  assert.deepEqual(task.playlet.productionProcessFiles, fixture.playlet.productionProcessFiles);
  assert.deepEqual(calls, [
    {
      path: "/dramaAiRpa/tencent/accountTask/page",
      payload: {
        page: 1,
        pageSize: 100,
        dramaId: null,
        originalTitle: null,
        accountId: fixture.accountId,
        accountName: null,
        status: "READY",
        auditStatus: null,
      },
    },
    {
      path: "/dramaAiRpa/tencent/rpa/claim",
      payload: { accountTaskId: fixture.accountTaskId },
    },
  ]);
});

test("reports Tencent Huolong results with taskId and success", async () => {
  const calls: Array<{ path: string; payload: Record<string, unknown> }> = [];
  const client: TencentHuolongHttpClient = {
    async post(path, payload) {
      calls.push({ path, payload: payload as Record<string, unknown> });
      return { code: 0, msg: "操作成功", data: true } as never;
    },
  };

  await reportTencentHuolongDramaTaskSuccessApi({
    client,
    accountTaskId: 88,
    platformDramaId: "album-123",
    resultJson: { activeUrl: "https://mp.v.qq.com/kairos/album/create" },
  });
  await reportTencentHuolongDramaTaskErrorApi({
    client,
    accountTaskId: 89,
    failStage: "FILL_FORM",
    errorMessage: "题材类型填写失败",
  });
  await reportTencentHuolongDramaTaskErrorApi({
    client,
    accountTaskId: 90,
    failStage: "OTHER",
    errorMessage: "Target page, context or browser has been closed",
  });

  assert.deepEqual(calls.map((call) => call.path), [
    "/dramaAiRpa/tencent/rpa/report",
    "/dramaAiRpa/tencent/rpa/report",
  ]);
  assert.equal(calls[0]?.payload.taskId, 88);
  assert.equal(calls[0]?.payload.success, true);
  assert.equal(calls[0]?.payload.platformDramaId, "album-123");
  assert.equal("accountTaskId" in (calls[0]?.payload ?? {}), false);
  assert.equal("rpaStatus" in (calls[0]?.payload ?? {}), false);
  assert.equal(calls[1]?.payload.taskId, 89);
  assert.equal(calls[1]?.payload.success, false);
  assert.equal(calls[1]?.payload.failStage, "FILL_FORM");
  assert.equal(calls[1]?.payload.errorMessage, "题材类型填写失败");
});

test("reports an invalid claimed Tencent Huolong task and leaves the queue idle", async () => {
  const calls: Array<{ path: string; payload: Record<string, unknown> }> = [];
  const client: TencentHuolongHttpClient = {
    async post(path, payload) {
      calls.push({ path, payload: payload as Record<string, unknown> });
      if (path.endsWith("/accountTask/page")) {
        return {
          code: 0,
          msg: "操作成功",
          data: { data: [{
            id: 91,
            dramaId: 1466,
            accountId: "tencent-account-1",
            status: "READY",
            originalTitle: "字段无效任务",
          }] },
        } as never;
      }
      if (path.endsWith("/rpa/claim")) {
        return {
          code: 0,
          msg: "操作成功",
          data: {
            accountTaskId: 91,
            accountId: "tencent-account-1",
            originalTitle: "字段无效任务",
            payloadJson: {
              name: "这是一个超过二十个汉字限制因而无法提交到火龙平台的无效剧名",
              summary: "这是一个包含无效标题字段的测试任务，用于验证领取后的错误回写。",
              episodeCount: 10,
              tencentHuolongPlaylet: { themeType: "都市" },
            },
          },
        } as never;
      }
      return { code: 0, msg: "操作成功", data: true } as never;
    },
  };

  const task = await claimNextTencentHuolongDramaTaskApi({
    client,
    runtimeOptions: { accountId: "tencent-account-1" },
  });

  assert.equal(task, null);
  const report = calls.find((call) => call.path.endsWith("/rpa/report"));
  assert.ok(report);
  assert.equal(report.payload.taskId, 91);
  assert.equal(report.payload.success, false);
  assert.equal(report.payload.failStage, "OTHER");
  assert.match(String(report.payload.errorMessage), /playlet\.title/u);
});
