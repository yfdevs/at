import { log } from "../shared/logger.js";
import {
  claimedQqDramaTaskSchema,
  type ClaimedQqDramaTask,
  type QqDramaApiConfig,
  type QqDramaRuntimeOptions,
  type QqDramaTaskFailStage,
  type QqDramaTaskStatus,
} from "../shared/types.js";
import type { QqDramaHttpClient } from "./http-client.js";

export type QqDramaTaskApiEndpoints = {
  accountTaskPage: string;
  claimTask: string;
  successCallback: string;
  failCallback: string;
};

export type QqDramaTaskApiOptions = {
  apiConfig?: QqDramaApiConfig;
  client?: QqDramaHttpClient;
  endpoints?: Partial<QqDramaTaskApiEndpoints>;
};

export type ClaimNextQqDramaTaskOptions = QqDramaTaskApiOptions & {
  runtimeOptions?: QqDramaRuntimeOptions;
  rpaStatus?: QqDramaTaskStatus;
};

export type QqDramaTaskSuccessReport = QqDramaTaskApiOptions & {
  runtimeOptions?: QqDramaRuntimeOptions;
  accountTaskId: number;
  resultJson?: Record<string, unknown>;
  rpaStatus?: QqDramaTaskStatus;
};

export type QqDramaTaskErrorReport = QqDramaTaskApiOptions & {
  runtimeOptions?: QqDramaRuntimeOptions;
  accountTaskId: number;
  dramaId?: number;
  failStage: QqDramaTaskFailStage;
  errorMessage: string;
  resultJson?: Record<string, unknown>;
};

const fakeClaimedTask = claimedQqDramaTaskSchema.parse({
  accountTaskId: 595,
  dramaId: 990001,
  originalTitle: "寒门古井通现代，我靠古董养活一座城",
  qqAccountId: "default",
  qqAccountName: "小石榴漫剧",
  playlet: {
    title: "古井通今：我靠古董养一城",
    summary:
      "寒门青年因机缘发现祖宅古井可通古代乱世边城。彼时城中兵民被围、饥寒交迫，他将现代物资不断投入井中，解决粮食、御寒与医疗危机，逐步成为古人心中的“神明”。古代回赠的珍稀古董与药材，则让他在现代迅速崛起，摆脱贫困并反击对手。随着两界联系加深，他不仅靠古董交易积累财富，更参与城池重建与命运博弈，在商业竞争与权谋暗流中周旋，最终实现个人逆袭，也改变了一座城的生死与未来。",
    baiduPanResourceLink:
      "通过网盘分享的文件：寒门古井通现代，我靠古董养活一座城\n" +
      "链接: https://pan.baidu.com/s/1qwfcWYS2-2zRiEz9DsyXFw?pwd=5ns3 提取码: 5ns3\n" +
      "--来自百度网盘超级会员v3的分享",
    audienceType: "男频",
    coverImageUrl:
      "https://misu-launch-lianshan-beijing-final.tos-cn-beijing.volces.com/drama-ai-rpa/posters/20260716/account-task-595-c9f666e7e0b44584b97ffcd2e46e411d.jpg",
    episodeCount: 58,
    updateStatus: "已完结",
    isAiGenerated: "是",
    primaryCategory: "都市",
    secondaryCategory: "都市职场",
    isSeries: "是",
    comicType: "漫剧",
    productionOrganization: "小石榴影像工作室",
    producers: ["陈一鸣"],
    directors: ["周南"],
    screenwriters: ["许安然", "林乔"],
    roles: [
      {
        name: "林知夏",
        description: "女主角，外柔内韧，重生后主动改写命运。",
      },
      {
        name: "顾承砚",
        description: "男主角，沉稳克制，暗中守护女主并协助追查真相。",
      },
    ],
    productionCostRange: "< 30 万",
    productionCostWan: 18,
    productionYear: 2026,
    costAllocationReportFile:
      "https://misu-launch-lianshan-beijing-final.tos-cn-beijing.volces.com/drama-ai-rpa/contracts/20260716/account-task-595-0f639f4afdee4095b37906b580d77f70.png",
    copyrightProofFile:
      "https://misu-launch-lianshan-beijing-final.tos-cn-beijing.volces.com/drama-ai-rpa/contracts/20260716/account-task-595-a9c40ddd187b41e880699c1cba233cfd.png",
    contractName: "【明星说漫剧】QQ漫剧协议（665599744810680320）",
  },
});

function fakeTaskWithId(accountTaskId: number): ClaimedQqDramaTask {
  return claimedQqDramaTaskSchema.parse({
    ...fakeClaimedTask,
    accountTaskId,
  });
}

// 按指定任务 ID 领取 QQ 上剧任务，用于人工指定或重试单个任务。
export async function claimQqDramaTaskByIdApi(
  options: ClaimNextQqDramaTaskOptions & { accountTaskId: number },
): Promise<ClaimedQqDramaTask | null> {
  log(
    options.runtimeOptions ?? {},
    `[qq-drama] fake claim task: accountTaskId=${options.accountTaskId}`,
  );
  return fakeTaskWithId(options.accountTaskId);
}

// 领取下一条可执行的 QQ 上剧任务，任务循环会定时调用这个接口。
export async function claimNextQqDramaTaskApi(
  options: ClaimNextQqDramaTaskOptions,
): Promise<ClaimedQqDramaTask | null> {
  log(options.runtimeOptions ?? {}, "[qq-drama] fake claim next task");
  return fakeClaimedTask;
}

// 上剧任务执行成功后的回调接口，用于通知业务系统更新任务状态。
export async function reportQqDramaTaskSuccessApi(report: QqDramaTaskSuccessReport): Promise<void> {
  log(
    report.runtimeOptions ?? {},
    `[qq-drama] fake success callback: accountTaskId=${report.accountTaskId}`,
  );
}

// 上剧任务执行失败后的回调接口，用于上报失败阶段、错误信息和页面状态。
export async function reportQqDramaTaskErrorApi(report: QqDramaTaskErrorReport): Promise<void> {
  log(
    report.runtimeOptions ?? {},
    `[qq-drama] fake fail callback: accountTaskId=${report.accountTaskId} failStage=${report.failStage} error=${report.errorMessage}`,
  );
}
