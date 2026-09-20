import assert from "node:assert/strict";
import test from "node:test";
import {
  claimNextDouyinDramaTaskApi,
  normalizeClaimedDouyinDramaTask,
  reportDouyinDramaTaskErrorApi,
  reportDouyinDramaTaskSuccessApi,
  resetMockDouyinDramaTaskApi,
} from "../../src/api/task.js";
import {
  createMockDouyinCopyrightSeriesTask,
  createMockDouyinNetdiskTestTask,
  DOUYIN_DRAMA_MOCK_DOCUMENT_URL,
  DOUYIN_DRAMA_MOCK_IMAGE_URL,
  createMockDouyinSelfProducedAiTask,
  createMockDouyinSelfProducedNonAiTask,
} from "../../src/api/mock-task.js";
import {
  DOUYIN_DRAMA_AIGC_TOOL,
  DOUYIN_DRAMA_CREATOR_NAME,
  DOUYIN_DRAMA_PRODUCTION_TEAM,
} from "../../src/shared/constants.js";
import { douyinDramaTaskPayloadSchema } from "../../src/shared/types.js";
import type { DouyinDramaHttpClient } from "../../src/api/http-client.js";

const requiredMaterialReferences = {
  scheduledPublishAt: "2026-09-22 18:00:00",
  costConfigurationFiles: [DOUYIN_DRAMA_MOCK_IMAGE_URL],
  ownershipProofFiles: [DOUYIN_DRAMA_MOCK_DOCUMENT_URL],
  nonInfringementCommitmentFiles: [DOUYIN_DRAMA_MOCK_DOCUMENT_URL],
};

test("normalization locks the platform-fixed fields", () => {
  const task = normalizeClaimedDouyinDramaTask({
    accountTaskId: 8,
    originalTitle: "测试剧",
    payloadJson: {
      name: "测试剧",
      summary: "用于验证抖音任务固定字段的测试简介。",
      episodeCount: 2,
      douyinPlaylet: {
        categories: ["剧情"],
        audience: "通用",
        roles: [{ name: "甲" }, { name: "乙" }],
        updateStatus: "连载中",
        productionOrganization: "错误机构",
        producers: ["错误制片人"],
        directors: ["错误导演"],
        screenwriters: ["错误编剧"],
        productionCostRange: "80万及以上",
        productionCostWan: 88,
        ...requiredMaterialReferences,
      },
    },
  });

  assert.equal(task.playlet.updateStatus, "已完结");
  assert.equal(task.playlet.productionOrganization, DOUYIN_DRAMA_PRODUCTION_TEAM);
  assert.deepEqual(task.playlet.producers, [DOUYIN_DRAMA_CREATOR_NAME]);
  assert.deepEqual(task.playlet.directors, [DOUYIN_DRAMA_CREATOR_NAME]);
  assert.deepEqual(task.playlet.screenwriters, []);
  assert.equal(task.playlet.productionCostRange, "30万以下");
  assert.equal(task.playlet.productionCostWan, 1);
});

test("derives update status and production cost range without backend input", () => {
  const task = douyinDramaTaskPayloadSchema.parse({
    title: "测试剧",
    summary: "用于验证固定字段由自动化程序生成，而不是由后台用户传入。",
    episodeCount: 2,
    isAi: false,
    categories: ["剧情"],
    audience: "通用",
    roles: [{ name: "甲" }, { name: "乙" }],
    ...requiredMaterialReferences,
    updateStatus: "连载中",
    productionCostRange: "80万及以上",
  });

  assert.equal(task.updateStatus, "已完结");
  assert.equal(task.productionCostRange, "30万以下");
  assert.equal(task.productionOrganization, DOUYIN_DRAMA_PRODUCTION_TEAM);
  assert.deepEqual(task.producers, [DOUYIN_DRAMA_CREATOR_NAME]);
  assert.deepEqual(task.directors, [DOUYIN_DRAMA_CREATOR_NAME]);
  assert.deepEqual(task.screenwriters, []);
});

test("rejects missing business material references before resource downloading", () => {
  assert.throws(
    () => normalizeClaimedDouyinDramaTask({
      accountTaskId: 9,
      originalTitle: "缺少合同材料的测试剧",
      payloadJson: {
        name: "缺少合同材料的测试剧",
        summary: "该任务故意不提供成本配置、权属和不侵权承诺函，用于验证领取阶段提前失败。",
        episodeCount: 2,
        douyinPlaylet: {
          categories: ["剧情"],
          audience: "通用",
          roles: [{ name: "甲" }, { name: "乙" }],
        },
      },
    }),
    /DOUYIN_DRAMA_CLAIMED_TASK_INVALID:.*costConfigurationFiles/u,
  );
});

test("provides AI, non-AI, and copyright-series mock builders", () => {
  const ai = createMockDouyinSelfProducedAiTask();
  const nonAi = createMockDouyinSelfProducedNonAiTask();
  const series = createMockDouyinCopyrightSeriesTask({ copyrightIpName: "海上奇缘" });

  assert.equal(ai.playlet.isAi, true);
  assert.deepEqual(ai.playlet.aigcTools, [DOUYIN_DRAMA_AIGC_TOOL]);
  assert.equal(ai.playlet.roles.length, 2);
  assert.ok(ai.playlet.roles.every((role) => role.photoFile && role.intro && role.roleType));
  assert.equal(ai.playlet.costConfigurationFiles.length, 1);
  assert.equal(ai.playlet.payCommitmentFiles.length, 0);
  assert.equal(ai.playlet.ownershipProofFiles.length, 1);
  assert.equal(ai.playlet.nonInfringementCommitmentFiles.length, 1);
  assert.equal(ai.playlet.projectScreenshotFiles.length, 0);
  assert.equal(nonAi.playlet.isAi, false);
  assert.deepEqual(nonAi.playlet.aigcTools, []);
  assert.equal(series.playlet.isSeries, true);
  assert.equal(series.playlet.isCopyrightIpAdaptation, true);
  assert.equal(series.playlet.copyrightIpName, "海上奇缘");
  assert.equal(ai.playlet.submit, false);
  assert.equal(nonAi.playlet.submit, false);
  assert.equal(series.playlet.submit, false);

  const netdisk = createMockDouyinNetdiskTestTask();
  assert.equal(netdisk.playlet.summary, "");
  assert.deepEqual(netdisk.playlet.roles, []);
  assert.deepEqual(netdisk.playlet.costConfigurationFiles, [DOUYIN_DRAMA_MOCK_IMAGE_URL]);
  assert.deepEqual(netdisk.playlet.nonInfringementCommitmentFiles, [DOUYIN_DRAMA_MOCK_IMAGE_URL]);
  assert.equal(netdisk.playlet.useFirstAvailableContract, true);
  assert.equal(netdisk.playlet.publishMode, "自主发布");
  assert.equal(netdisk.playlet.publishAccountName, "兜兜动漫");
  assert.match(netdisk.playlet.scheduledPublishAt, /^\d{4}-\d{2}-\d{2} \d{2}:00:00$/u);
  assert.equal(netdisk.playlet.costConfigurationFiles.length, 1);
  assert.equal(netdisk.playlet.payCommitmentFiles.length, 0);
  assert.equal(netdisk.playlet.ownershipProofFiles.length, 1);
  assert.equal(netdisk.playlet.nonInfringementCommitmentFiles.length, 1);
  assert.equal(netdisk.playlet.projectScreenshotFiles.length, 0);
});

test("runs one local netdisk task for the temporary phone account without backend calls", async () => {
  const accountId = "17732354154";
  let backendCallCount = 0;
  const client = {
    async post() {
      backendCallCount += 1;
      throw new Error("the mock task must not call the unfinished backend");
    },
  } as DouyinDramaHttpClient;
  const runtimeOptions = { douyinAccountId: accountId, douyinAccountName: accountId };
  resetMockDouyinDramaTaskApi(accountId);

  const task = await claimNextDouyinDramaTaskApi({ client, runtimeOptions });
  assert.equal(task?.douyinAccountId, accountId);
  assert.equal(task?.originalTitle, "货车被当免费拉货站，我收车");
  assert.equal(task?.playlet.episodeCount, 35);
  assert.match(task?.playlet.baiduPanResourceLink ?? "", /1GyEobepwLhJj5ND2swgvIQ/u);
  assert.equal(await claimNextDouyinDramaTaskApi({ client, runtimeOptions }), null);

  await reportDouyinDramaTaskErrorApi({
    client,
    runtimeOptions,
    accountTaskId: task!.accountTaskId,
    failStage: "OTHER",
    errorMessage: "本地假任务测试错误",
  });
  assert.equal(backendCallCount, 0);
});

test("uses the same READY -> claim -> report protocol as other platform adapters", async () => {
  const calls: Array<{ path: string; payload: unknown }> = [];
  const responses: unknown[] = [
    {
      code: 0,
      data: {
        total: 1,
        data: [{
          id: 91,
          dramaId: 7,
          accountId: "dy-1",
          accountName: "抖音账号一",
          status: "READY",
          originalTitle: "后台测试剧",
        }],
      },
    },
    {
      code: 0,
      data: {
        accountTaskId: 91,
        accountId: "dy-1",
        accountName: "抖音账号一",
        originalTitle: "后台测试剧",
        payloadJson: {
          name: "后台测试剧",
          summary: "这是由后台任务页选择业务字段后生成的测试剧情简介。",
          episodeCount: 2,
          douyinPlaylet: {
            categories: ["剧情"],
            audience: "通用",
            isAi: false,
            isSeries: false,
            isCopyrightIpAdaptation: false,
            publishMode: "自主发布",
            publishAccountName: "兜兜动漫",
            scheduledPublishAt: "2026-09-22 18:00:00",
            roles: [{ name: "甲" }, { name: "乙" }],
            ...requiredMaterialReferences,
          },
        },
      },
    },
    { code: 0, data: true },
  ];
  const client = {
    async post(path: string, payload: unknown) {
      calls.push({ path, payload });
      return responses.shift();
    },
  } as DouyinDramaHttpClient;
  const runtimeOptions = { douyinAccountId: "dy-1", douyinAccountName: "抖音账号一" };

  const task = await claimNextDouyinDramaTaskApi({ client, runtimeOptions });
  assert.equal(task?.accountTaskId, 91);
  assert.equal(task?.playlet.isAi, false);
  assert.equal(task?.playlet.audience, "通用");
  assert.equal(task?.playlet.publishAccountName, "兜兜动漫");
  assert.equal(task?.playlet.scheduledPublishAt, "2026-09-22 18:00:00");
  await reportDouyinDramaTaskSuccessApi({
    client,
    runtimeOptions,
    accountTaskId: task!.accountTaskId,
  });

  assert.deepEqual(calls.map((call) => call.path), [
    "/dramaAiRpa/douyin/accountTask/page",
    "/dramaAiRpa/douyin/rpa/claim",
    "/dramaAiRpa/douyin/rpa/report",
  ]);
});
