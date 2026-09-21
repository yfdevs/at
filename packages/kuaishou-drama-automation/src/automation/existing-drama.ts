import type { Page } from "playwright";
import { KUAISHOU_DRAMA_QUERY_LIST_URL } from "../shared/constants.js";
import type {
  KuaishouDramaPublishVariant,
  KuaishouDramaRuntimeOptions,
} from "../shared/types.js";
import { log } from "./browser-session.js";

export type KuaishouDramaQuerySaleType = 0 | 1;

type ExistingDramaListItem = {
  miniSeriesId?: unknown;
  courseName?: unknown;
  auditStatus?: unknown;
  seriesPackageSaleType?: unknown;
};

type ExistingDramaQueryResponse = {
  result?: unknown;
  successful?: unknown;
  error_msg?: unknown;
  data?: {
    data?: unknown;
  };
};

export function kuaishouQuerySaleType(
  variant: KuaishouDramaPublishVariant,
): KuaishouDramaQuerySaleType {
  return variant.kind === "full-paid" ? 0 : 1;
}

export function findExistingKuaishouDrama(
  response: unknown,
  title: string,
  saleType: KuaishouDramaQuerySaleType,
) {
  if (!response || typeof response !== "object") {
    throw new Error("KUAISHOU_DRAMA_EXISTING_QUERY_INVALID_RESPONSE");
  }

  const parsed = response as ExistingDramaQueryResponse;
  if (parsed.successful !== true || parsed.result !== 1) {
    const message = typeof parsed.error_msg === "string" ? parsed.error_msg : "unknown";
    throw new Error(`KUAISHOU_DRAMA_EXISTING_QUERY_FAILED: ${message}`);
  }

  const items = parsed.data?.data;
  if (!Array.isArray(items)) {
    throw new Error("KUAISHOU_DRAMA_EXISTING_QUERY_DATA_MISSING");
  }

  const normalizedTitle = title.trim();
  const matches = (items as ExistingDramaListItem[]).filter((item) => {
    if (typeof item.courseName !== "string" || item.courseName.trim() !== normalizedTitle) {
      return false;
    }
    if (item.auditStatus !== 1) return false;
    if (
      Array.isArray(item.seriesPackageSaleType) &&
      !item.seriesPackageSaleType.includes(saleType)
    ) {
      return false;
    }
    return Number.isInteger(item.miniSeriesId) && Number(item.miniSeriesId) > 0;
  });

  if (matches.length > 1) {
    throw new Error(
      `KUAISHOU_DRAMA_EXISTING_QUERY_AMBIGUOUS: title=${normalizedTitle} ` +
        `saleType=${saleType} count=${matches.length}`,
    );
  }

  return matches.length === 1
    ? { miniSeriesId: Number(matches[0]!.miniSeriesId), title: normalizedTitle, saleType }
    : null;
}

export async function queryExistingKuaishouDrama(
  page: Page,
  variant: KuaishouDramaPublishVariant,
  options: KuaishouDramaRuntimeOptions,
) {
  const saleType = kuaishouQuerySaleType(variant);
  log(
    options,
    `[kuaishou-drama] checking existing drama: title=${variant.title} ` +
      `saleType=${saleType} auditStatus=1`,
  );

  const result = await page.evaluate(
    async ({ endpoint, title, saleType: requestedSaleType }) => {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          pageNum: 1,
          pageSize: 10,
          episodeTitle: "",
          sellingStatus: 0,
          queryType: 0,
          sortParam: {},
          miniSeriesTitle: title,
          auditStatus: 1,
          seriesIdList: [],
          createDateFrom: "",
          createDateTo: "",
          saleType: requestedSaleType,
          sourceType4Filter: null,
        }),
      });
      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP_${response.status}: ${responseText.slice(0, 500)}`);
      }
      try {
        return JSON.parse(responseText) as unknown;
      } catch {
        throw new Error(`INVALID_JSON: ${responseText.slice(0, 500)}`);
      }
    },
    { endpoint: KUAISHOU_DRAMA_QUERY_LIST_URL, title: variant.title, saleType },
  ).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`KUAISHOU_DRAMA_EXISTING_QUERY_REQUEST_FAILED: ${message}`);
  });

  const existing = findExistingKuaishouDrama(result, variant.title, saleType);
  log(
    options,
    existing
      ? `[kuaishou-drama] existing drama found: title=${variant.title} ` +
        `saleType=${saleType} miniSeriesId=${existing.miniSeriesId}`
      : `[kuaishou-drama] existing drama not found: title=${variant.title} saleType=${saleType}`,
  );
  return existing;
}

export async function openExistingKuaishouDramaVideoStep(
  page: Page,
  miniSeriesId: number,
  options: KuaishouDramaRuntimeOptions,
) {
  const url = new URL("https://kdj.kuaishou.com/home/content/content-management/edit");
  url.searchParams.set("miniSeriesId", String(miniSeriesId));
  url.searchParams.set("step", "1");
  log(options, `[kuaishou-drama] opening existing drama video step: ${url.href}`);
  await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator('input#batch-upload[type="file"][multiple]').first()
    .waitFor({ state: "attached", timeout: 60_000 });
}
