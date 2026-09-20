import type { Page } from "playwright";
import { z } from "zod";
import {
  PINDUODUO_DEFAULT_COPYRIGHT_EXPIRE_TIME,
  PINDUODUO_DRAMA_CATEGORY_OPTIONS,
  PINDUODUO_SHORTPLAY_APPLY_EDIT_URL,
  PINDUODUO_SHORTPLAY_MANAGE_URL,
} from "../shared/constants.js";
import type {
  ClaimedPinduoduoDramaTask,
  PinduoduoDramaTaskPayload,
} from "../shared/types.js";

const shortplayApplyEditVoSchema = z.object({
  // 短剧类型固定为 1。
  content_type: z.coerce.number().default(1).pipe(z.literal(1)).describe("短剧类型：固定 1"),
  // 子类型：1=AI仿真人剧，2=动态漫，3=解说剧。
  sub_content_type: z.coerce.number().default(1).pipe(z.union([z.literal(1), z.literal(2), z.literal(3)])).describe("子类型：1=AI仿真人剧，2=动态漫，3=解说剧"),
  is_series_play: z.union([z.literal(0), z.literal(1)]).describe("是否系列剧"),
  // 版权类型：1=自有版权，2=代理转授权；默认 2。
  copyright: z.coerce.number().default(2).pipe(z.union([z.literal(1), z.literal(2)])).describe("版权类型：1=自有版权，2=代理转授权；默认 2"),
  copyright_expire_time: z.coerce.number().int().positive().default(PINDUODUO_DEFAULT_COPYRIGHT_EXPIRE_TIME).describe("授权到期时间戳：默认 2026-10-29 00:00:00"),
  title: z.string().trim().min(1).max(60).describe("短剧名称"),
  director: z.string().trim().min(1).describe("导演"),
  producer: z.string().trim().min(1).describe("制片人"),
  script_writer: z.string().trim().min(1).describe("编剧"),
  role: z.string().trim().min(1).describe("动漫主角名"),
  episode_count: z.string().trim().min(1).describe("短剧集数"),
  duration_minutes: z.string().trim().min(1).default("1").describe("单集时长分钟数：默认 1"),
  duration_seconds: z.string().trim().min(1).default("1").describe("单集时长秒数：默认 1"),
  // 内容分类：1=男频，2=女频。
  cate: z.coerce.number().default(1).pipe(z.union([z.literal(1), z.literal(2)])).describe("内容分类：1=男频，2=女频"),
  label_ids: z.array(
    z.coerce.number().int().positive().refine(
      (labelId) => Object.prototype.hasOwnProperty.call(PINDUODUO_DRAMA_CATEGORY_OPTIONS, String(labelId)),
      "选择标签必须是 PINDUODUO_DRAMA_CATEGORY_OPTIONS 的 key",
    ),
  ).min(1).describe("选择标签"),
  copyright_agency: z.string().trim().min(1).describe("制作版权机构"),
  cost: z.string().trim().min(1).default("1").describe("制作成本：默认 1"),
  icp_number: z.string().default("").describe("ICP备案号：默认空字符串"),
  salary_percent: z.string().trim().min(1).default("10").describe("全部演员片酬占制作总成本百分比：默认 10"),
  major_salary_percent: z.string().trim().min(1).default("10").describe("主要演员片酬占总片酬百分比：默认 10"),
  online_time: z.coerce.number().int().positive().describe("全网上线时间：程序动态生成当前毫秒时间戳"),
  demo_url: z.string().trim().min(1).describe("百度网盘链接"),
  summary: z.string().trim().min(300).describe("内容概要：不能少于 300 字"),
});

export const pinduoduoShortplayApplyEditRequestSchema = z.object({
  topic_apply_edit_vos: z.array(shortplayApplyEditVoSchema).min(1).describe("提报短剧列表"),
});

export const pinduoduoShortplayApplyEditResponseSchema = z
  .object({
    code: z.coerce.number().optional(),
    error_code: z.coerce.number().optional(),
    success: z.boolean().optional(),
    msg: z.string().optional(),
    message: z.string().optional(),
    error_msg: z.string().optional(),
  })
  .passthrough();

export type PinduoduoShortplayApplyEditRequest = z.infer<typeof pinduoduoShortplayApplyEditRequestSchema>;
export type PinduoduoShortplayApplyEditResponse = z.infer<typeof pinduoduoShortplayApplyEditResponseSchema>;

export class PinduoduoShortplayApplyEditError extends Error {
  constructor(
    message: string,
    readonly response?: PinduoduoShortplayApplyEditResponse,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "PinduoduoShortplayApplyEditError";
  }
}

function formatApplyEditErrorMessage(
  payload: PinduoduoShortplayApplyEditResponse,
  fallback: string,
): string {
  const errorCode = payload.error_code ?? payload.code;
  const message = payload.error_msg || payload.msg || payload.message || fallback;
  const codeText = typeof errorCode === "number" ? ` error_code=${errorCode}` : "";
  return `Pinduoduo shortplay apply edit failed:${codeText} ${message}`;
}

function buildShortplayApplyEditVo(playlet: PinduoduoDramaTaskPayload) {
  return shortplayApplyEditVoSchema.parse({
    content_type: playlet.contentType,
    sub_content_type: playlet.subContentType,
    is_series_play: playlet.isSeriesPlay ? 1 : 0,
    copyright: playlet.copyright,
    copyright_expire_time: playlet.copyrightExpireTime,
    title: playlet.title,
    director: playlet.director,
    producer: playlet.producer,
    script_writer: playlet.scriptWriter,
    role: playlet.role,
    episode_count: String(playlet.episodeCount),
    duration_minutes: String(playlet.durationMinutes),
    duration_seconds: String(playlet.durationSeconds),
    cate: playlet.cate,
    label_ids: playlet.labelIds,
    copyright_agency: playlet.copyrightAgency,
    cost: playlet.cost,
    icp_number: playlet.icpNumber,
    salary_percent: playlet.salaryPercent,
    major_salary_percent: playlet.majorSalaryPercent,
    online_time: Date.now(),
    demo_url: playlet.demoUrl,
    summary: playlet.summary,
  });
}

export function buildPinduoduoShortplayApplyEditRequest(
  task: ClaimedPinduoduoDramaTask,
): PinduoduoShortplayApplyEditRequest {
  return pinduoduoShortplayApplyEditRequestSchema.parse({
    topic_apply_edit_vos: [buildShortplayApplyEditVo(task.playlet)],
  });
}

export async function submitPinduoduoShortplayApplyEdit(
  page: Page,
  task: ClaimedPinduoduoDramaTask,
): Promise<PinduoduoShortplayApplyEditResponse> {
  const body = buildPinduoduoShortplayApplyEditRequest(task);
  const result = await page.evaluate(
    async ({ requestBody, referrer, url }) => {
      const response = await fetch(url, {
        body: JSON.stringify(requestBody),
        credentials: "include",
        headers: {
          accept: "*/*",
          "content-type": "application/json",
        },
        method: "POST",
        mode: "cors",
        referrer,
      });
      const text = await response.text();
      let payload: unknown = text;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { message: text };
      }

      return {
        ok: response.ok,
        payload,
        status: response.status,
        statusText: response.statusText,
      };
    },
    {
      requestBody: body,
      referrer: PINDUODUO_SHORTPLAY_MANAGE_URL,
      url: PINDUODUO_SHORTPLAY_APPLY_EDIT_URL,
    },
  );

  const payload = pinduoduoShortplayApplyEditResponseSchema.parse(result.payload);
  if (!result.ok) {
    throw new PinduoduoShortplayApplyEditError(
      `Pinduoduo shortplay apply edit failed: HTTP ${result.status} ${result.statusText}`,
      payload,
      result.status,
    );
  }
  if (typeof payload.code === "number" && payload.code !== 0) {
    throw new PinduoduoShortplayApplyEditError(
      formatApplyEditErrorMessage(payload, `code=${payload.code}`),
      payload,
      result.status,
    );
  }
  if (payload.success === false) {
    throw new PinduoduoShortplayApplyEditError(
      formatApplyEditErrorMessage(payload, "submit returned success=false"),
      payload,
      result.status,
    );
  }

  return payload;
}
