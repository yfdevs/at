import { z } from "zod";

const accountConfigSchema = z.object({
  id: z.coerce.number().int().positive(),
  accountId: z.string().trim().min(1),
  accountName: z.string().trim().min(1),
  loginAccount: z.string().nullish(),
  rpaProfileKey: z.string().nullish(),
  sortNo: z.coerce.number().optional(),
  status: z.string(),
});

const accountConfigPageResponseSchema = z.object({
  code: z.number(),
  msg: z.string().nullish(),
  data: z
    .object({
      total: z.coerce.number().int().nonnegative().optional(),
      data: z.array(accountConfigSchema),
    })
    .nullish(),
});

export type BaiduDramaAccount = {
  id: number;
  accountId: string;
  accountName: string;
  loginAccount?: string | null;
  rpaProfileKey?: string | null;
};

const pageSize = 100;

export async function fetchBaiduDramaAccounts(
  apiBaseUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<BaiduDramaAccount[]> {
  const baseUrl = apiBaseUrl.trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("BAIDU_DRAMA_API_BASE_URL_REQUIRED");

  const fetchedAccounts: z.infer<typeof accountConfigSchema>[] = [];
  for (let page = 1; ; page += 1) {
    const response = await fetcher(
      `${baseUrl}/dramaAiRpa/baidu/accountConfig/page`,
      {
        method: "POST",
        headers: {
          accept: "application/json, text/plain, */*",
          "content-type": "application/json;charset=UTF-8",
        },
        body: JSON.stringify({
          page,
          pageSize,
          accountId: null,
          accountName: null,
          status: "ON",
        }),
      },
    );
    if (!response.ok) {
      throw new Error(
        `BAIDU_DRAMA_ACCOUNT_CONFIG_REQUEST_FAILED: status=${response.status}`,
      );
    }

    const payload = accountConfigPageResponseSchema.parse(await response.json());
    if (payload.code !== 0) {
      throw new Error(
        `BAIDU_DRAMA_ACCOUNT_CONFIG_REQUEST_FAILED: code=${payload.code} ` +
          `message=${payload.msg || "-"}`,
      );
    }
    if (!payload.data) {
      throw new Error("BAIDU_DRAMA_ACCOUNT_CONFIG_RESPONSE_DATA_REQUIRED");
    }

    fetchedAccounts.push(...payload.data.data);
    if (
      payload.data.data.length < pageSize ||
      (payload.data.total !== undefined &&
        fetchedAccounts.length >= payload.data.total)
    ) {
      break;
    }
  }

  const uniqueAccounts = new Map<string, BaiduDramaAccount>();
  for (const account of fetchedAccounts
    .filter((item) => item.status === "ON")
    .sort((left, right) => (left.sortNo ?? 0) - (right.sortNo ?? 0))) {
    uniqueAccounts.set(account.accountId, {
      id: account.id,
      accountId: account.accountId,
      accountName: account.accountName,
      loginAccount: account.loginAccount,
      rpaProfileKey: account.rpaProfileKey,
    });
  }
  return [...uniqueAccounts.values()];
}
