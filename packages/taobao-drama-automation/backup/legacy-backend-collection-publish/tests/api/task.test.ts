// oxlint-disable typescript/no-floating-promises
import assert from "node:assert/strict";
import test from "node:test";

import type { TaobaoDramaHttpClient } from "../../src/api/http-client.js";
import {
  claimNextTaobaoDramaTaskApi,
  reportTaobaoAccountTaskApi,
} from "../../src/api/task.js";

test("lists, claims and normalizes dynamic Taobao collection fields", async () => {
  const calls: Array<{ path: string; payload: unknown }> = [];
  const client: TaobaoDramaHttpClient = {
    async post(path, payload) {
      calls.push({ path, payload });
      if (path.endsWith("/accountTask/page")) {
        return { code: 0, msg: "操作成功", data: { total: 1, data: [{
          id: 88,
          dramaId: 1688,
          accountId: "taobao-1",
          accountName: "淘宝一号",
          status: "READY",
          originalTitle: "逆风翻盘",
        }] } } as never;
      }
      if (path.endsWith("/rpa/claim")) {
        return { code: 0, msg: "操作成功", data: {
          accountTaskId: 88,
          accountId: "taobao-1",
          originalTitle: "逆风翻盘",
          payloadJson: {
            name: "逆风翻盘",
            summary: "女主从低谷重新出发并改变人生。",
            episodeCount: 60,
            baiduPanResourceLink: "https://pan.baidu.com/s/example?pwd=1234",
            taobaoPlaylet: {
              shortDramaType: "AI仿真人短剧",
              shortDramaTags: ["都市", "AI真人演绎剧", "逆袭", "逆袭"],
              audience: "女",
              sourceCoverUrl: "https://assets.example.test/cover.jpg",
            },
          },
        } } as never;
      }
      throw new Error(`unexpected path: ${path}`);
    },
  };

  const task = await claimNextTaobaoDramaTaskApi({
    apiBaseUrl: "http://api.example.test",
    account: { id: 1, accountId: "taobao-1", accountName: "淘宝一号" },
    client,
  });

  assert.ok(task);
  assert.equal(task.accountTaskId, 88);
  assert.equal(task.playlet.shortDramaType, "AI仿真人短剧");
  assert.deepEqual(task.playlet.shortDramaTags, ["都市", "AI真人演绎剧", "逆袭"]);
  assert.equal(task.playlet.audience, "女");
  assert.deepEqual(calls, [
    {
      path: "/dramaAiRpa/taobao/accountTask/page",
      payload: {
        page: 1,
        pageSize: 100,
        dramaId: null,
        originalTitle: null,
        accountId: "taobao-1",
        accountName: null,
        status: "READY",
        auditStatus: null,
      },
    },
    { path: "/dramaAiRpa/taobao/rpa/claim", payload: { accountTaskId: 88 } },
  ]);
});

test("reports Taobao task results with taskId and success", async () => {
  const calls: Array<{ path: string; payload: Record<string, unknown> }> = [];
  const client: TaobaoDramaHttpClient = {
    async post(path, payload) {
      calls.push({ path, payload: payload as Record<string, unknown> });
      return { code: 0, msg: "操作成功", data: true } as never;
    },
  };

  await reportTaobaoAccountTaskApi({
    apiBaseUrl: "http://api.example.test",
    client,
    report: { taskId: 88, success: true, resultJson: { episodeCount: 60 } },
  });
  await reportTaobaoAccountTaskApi({
    apiBaseUrl: "http://api.example.test",
    client,
    report: { taskId: 89, success: false, failStage: "SUBMIT", errorMessage: "发布失败" },
  });

  assert.deepEqual(calls.map((call) => call.path), [
    "/dramaAiRpa/taobao/rpa/report",
    "/dramaAiRpa/taobao/rpa/report",
  ]);
  assert.equal(calls[0]?.payload.taskId, 88);
  assert.equal(calls[0]?.payload.success, true);
  assert.equal(calls[1]?.payload.failStage, "SUBMIT");
});

test("reports an invalid claimed Taobao task and keeps looking safely", async () => {
  const calls: Array<{ path: string; payload: Record<string, unknown> }> = [];
  const client: TaobaoDramaHttpClient = {
    async post(path, payload) {
      calls.push({ path, payload: payload as Record<string, unknown> });
      if (path.endsWith("/accountTask/page")) {
        return { code: 0, msg: "操作成功", data: { data: [{
          id: 91,
          accountId: "taobao-1",
          status: "READY",
          originalTitle: "字段无效任务",
        }] } } as never;
      }
      if (path.endsWith("/rpa/claim")) {
        return { code: 0, msg: "操作成功", data: {
          accountTaskId: 91,
          accountId: "taobao-1",
          payloadJson: { name: "字段无效任务", summary: "缺少动态字段", episodeCount: 10 },
        } } as never;
      }
      return { code: 0, msg: "操作成功", data: true } as never;
    },
  };

  const task = await claimNextTaobaoDramaTaskApi({
    apiBaseUrl: "http://api.example.test",
    account: { id: 1, accountId: "taobao-1", accountName: "淘宝一号" },
    client,
  });

  assert.equal(task, null);
  const report = calls.find((call) => call.path.endsWith("/rpa/report"));
  assert.ok(report);
  assert.equal(report.payload.taskId, 91);
  assert.equal(report.payload.success, false);
  assert.match(String(report.payload.errorMessage), /shortDramaType/u);
});
