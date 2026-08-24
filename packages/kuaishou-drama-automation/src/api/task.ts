import { z } from "zod";
import { createMockKuaishouDramaTaskInput } from "../shared/task-config.js";
import {
  kuaishouDramaTaskSchema,
  type ClaimedKuaishouDramaTask,
} from "../shared/types.js";

const claimedKuaishouDramaTaskSchema = z.object({
  accountTaskId: z.coerce.number().int().positive(),
  dramaId: z.coerce.number().int().positive().optional(),
  originalTitle: z.string().trim().min(1),
  kuaishouAccountId: z.string().trim().min(1).optional(),
  kuaishouAccountName: z.string().trim().min(1).optional(),
  task: kuaishouDramaTaskSchema,
});

/**
 * 快手领取任务 API 占位实现。
 *
 * 后端接口确定后只替换此函数内部的请求与响应归一化逻辑；自动化运行时继续消费
 * ClaimedKuaishouDramaTask，不直接依赖后端 payloadJson 的原始形状。
 */
export async function claimNextKuaishouDramaTaskApi(): Promise<ClaimedKuaishouDramaTask | null> {
  const task = createMockKuaishouDramaTaskInput();
  return claimedKuaishouDramaTaskSchema.parse({
    accountTaskId: 202608210001,
    dramaId: 830152,
    originalTitle: task.title,
    kuaishouAccountId: "ks_10002861",
    kuaishouAccountName: "星河漫剧场",
    task,
  });
}

export async function reportKuaishouDramaTaskSuccessApi(
  _task: Pick<ClaimedKuaishouDramaTask, "accountTaskId">,
): Promise<void> {
  // TODO: 后端接口就绪后在此回写成功结果。
}

export async function reportKuaishouDramaTaskErrorApi(
  _task: Pick<ClaimedKuaishouDramaTask, "accountTaskId"> & { errorMessage: string },
): Promise<void> {
  // TODO: 后端接口就绪后在此回写失败结果。
}
