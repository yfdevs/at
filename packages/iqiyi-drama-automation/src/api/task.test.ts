// oxlint-disable typescript/no-floating-promises
import assert from "node:assert/strict";
import test from "node:test";

import {
  claimNextIqiyiDramaTaskApi,
  reportIqiyiDramaTaskErrorApi,
  reportIqiyiDramaTaskSuccessApi,
} from "./task.js";
import type { IqiyiDramaHttpClient } from "./http-client.js";
import { createIqiyiDramaTaskFixture } from "../testing/task-fixture.js";

test("lists and claims an iQIYI task through the unified API prefix", async () => {
  const fixture = createIqiyiDramaTaskFixture();
  const { copyright, ...iqiyiPlaylet } = fixture.playlet;
  const calls: Array<{ path: string; payload: unknown }> = [];
  const client: IqiyiDramaHttpClient = {
    async post(path, payload) {
      calls.push({ path, payload });
      if (path.endsWith("/accountTask/page")) {
        return {
          code: 0,
          msg: null,
          data: {
            total: 1,
            data: [{
              id: 88,
              dramaId: 1465,
              accountId: "iqiyi-account-1",
              accountName: "爱奇艺账号一",
              status: "READY",
              originalTitle: fixture.originalTitle,
            }],
          },
        } as never;
      }
      if (path.endsWith("/rpa/claim")) {
        return {
          code: 0,
          msg: null,
          data: {
            accountTaskId: 88,
            accountId: "iqiyi-account-1",
            originalTitle: fixture.originalTitle,
            payloadJson: {
              name: fixture.playlet.title,
              summary: fixture.playlet.summary,
              episodeCount: fixture.playlet.episodeCount,
              producerName: fixture.playlet.productionOrganization,
              copyright,
              iqiyiPlaylet,
            },
          },
        } as never;
      }
      throw new Error(`unexpected path: ${path}`);
    },
  };

  const task = await claimNextIqiyiDramaTaskApi({
    client,
    runtimeOptions: {
      iqiyiAccountId: "iqiyi-account-1",
      iqiyiAccountName: "爱奇艺账号一",
    },
  });

  assert.ok(task);
  assert.equal(task.accountTaskId, 88);
  assert.equal(task.dramaId, 1465);
  assert.equal(task.iqiyiAccountId, "iqiyi-account-1");
  assert.equal(calls[0]?.path, "/api/dramaAiRpa/iqiyi/accountTask/page");
  assert.deepEqual(calls[0]?.payload, {
    page: 1,
    pageSize: 100,
    dramaId: null,
    originalTitle: null,
    accountId: "iqiyi-account-1",
    accountName: null,
    status: "READY",
    auditStatus: null,
  });
  assert.equal(calls[1]?.path, "/api/dramaAiRpa/iqiyi/rpa/claim");
  assert.deepEqual(calls[1]?.payload, { accountTaskId: 88 });
});

for (const [field, invalidValue] of [
  ["dramaType", "短剧"],
  ["contentSource", "novel"],
] as const) {
  test(`rejects non-contract ${field} values instead of translating aliases`, async () => {
    const fixture = createIqiyiDramaTaskFixture();
    const { copyright, ...iqiyiPlaylet } = fixture.playlet;
    const calls: Array<{ path: string; payload: unknown }> = [];
    const task = await claimNextIqiyiDramaTaskApi({
      client: {
        async post(path, payload) {
          calls.push({ path, payload });
          if (path.endsWith("/accountTask/page")) {
            return {
              code: 0,
              msg: null,
              data: {
                total: 1,
                data: [{
                  id: 88,
                  dramaId: 1465,
                  accountId: "iqiyi-account-1",
                  accountName: "爱奇艺账号一",
                  status: "READY",
                  originalTitle: fixture.originalTitle,
                }],
              },
            } as never;
          }
          if (path.endsWith("/rpa/claim")) {
            return {
              code: 0,
              msg: null,
              data: {
                accountTaskId: 88,
                accountId: "iqiyi-account-1",
                originalTitle: fixture.originalTitle,
                payloadJson: {
                  name: fixture.originalTitle,
                  copyright,
                  iqiyiPlaylet: { ...iqiyiPlaylet, [field]: invalidValue },
                },
              },
            } as never;
          }
          if (path.endsWith("/rpa/report")) {
            return { code: 0, msg: null, data: true } as never;
          }
          throw new Error(`unexpected path: ${path}`);
        },
      },
      runtimeOptions: { iqiyiAccountId: "iqiyi-account-1" },
    });

    assert.equal(task, null);
    const reportCall = calls.find((call) => call.path.endsWith("/rpa/report"));
    assert.ok(reportCall);
    assert.match(String((reportCall.payload as Record<string, unknown>).errorMessage), new RegExp(field));
  });
}

test("treats the explicitly unavailable iQIYI task API as an empty queue", async () => {
  const calls: string[] = [];
  const task = await claimNextIqiyiDramaTaskApi({
    client: {
      async post(path) {
        calls.push(path);
        return { code: 500, msg: "爱奇艺账号发布任务暂未实现", data: null } as never;
      },
    },
    runtimeOptions: { iqiyiAccountId: "iqiyi-account-1" },
  });

  assert.equal(task, null);
  assert.deepEqual(calls, ["/api/dramaAiRpa/iqiyi/accountTask/page"]);
});

test("reports iQIYI task success and failure through the unified API prefix", async () => {
  const calls: Array<{ path: string; payload: Record<string, unknown> }> = [];
  const client: IqiyiDramaHttpClient = {
    async post(path, payload) {
      calls.push({ path, payload: payload as Record<string, unknown> });
      return { code: 0, msg: null, data: true } as never;
    },
  };

  await reportIqiyiDramaTaskSuccessApi({
    client,
    accountTaskId: 88,
    resultJson: { activeUrl: "https://creator.iqiyi.com/miniPlay/project/create" },
  });
  await reportIqiyiDramaTaskErrorApi({
    client,
    accountTaskId: 89,
    failStage: "FILL_FORM",
    errorMessage: "字段错误",
  });

  assert.deepEqual(calls.map((call) => call.path), [
    "/api/dramaAiRpa/iqiyi/rpa/report",
    "/api/dramaAiRpa/iqiyi/rpa/report",
  ]);
  assert.equal(calls[0]?.payload.taskId, 88);
  assert.equal(calls[0]?.payload.success, true);
  assert.deepEqual(calls[0]?.payload.resultJson, {
    activeUrl: "https://creator.iqiyi.com/miniPlay/project/create",
  });
  assert.equal(calls[1]?.payload.taskId, 89);
  assert.equal(calls[1]?.payload.success, false);
  assert.equal(calls[1]?.payload.failStage, "FILL_FORM");
  assert.equal(calls[1]?.payload.errorMessage, "字段错误");
});
