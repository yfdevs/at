import { z } from "zod";

const iqiyiAccountConfigSchema = z.object({
  id: z.coerce.number().int(),
  accountId: z.string().trim().min(1),
  accountName: z.string().trim().min(1),
  loginAccount: z.string().nullish(),
  rpaProfileKey: z.string().nullish(),
  configJson: z.unknown().nullish(),
  sortNo: z.coerce.number().optional(),
  status: z.string(),
  remark: z.string().nullish(),
});

const iqiyiAccountConfigPageResponseSchema = z.object({
  code: z.number(),
  msg: z.string().nullish(),
  data: z.object({
    total: z.coerce.number().int().nonnegative().optional(),
    data: z.array(iqiyiAccountConfigSchema),
  }).nullish(),
});

export type IqiyiDramaAccount = {
  id: number;
  accountId: string;
  accountName: string;
  loginAccount?: string | null;
  rpaProfileKey?: string | null;
};

const accountConfigPageSize = 100;

function accountConfigPageUrl(apiBaseUrl: string) {
  const baseUrl = apiBaseUrl.trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("IQIYI_DRAMA_API_BASE_URL_REQUIRED");
  return `${baseUrl}/api/dramaAiRpa/iqiyi/accountConfig/page`;
}

export async function fetchIqiyiDramaAccounts(
  apiBaseUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<IqiyiDramaAccount[]> {
  const fetchedAccounts: z.infer<typeof iqiyiAccountConfigSchema>[] = [];
  let page = 1;

  while (true) {
    const response = await fetcher(accountConfigPageUrl(apiBaseUrl), {
      method: "POST",
      headers: {
        accept: "application/json, text/plain, */*",
        "content-type": "application/json;charset=UTF-8",
      },
      body: JSON.stringify({
        page,
        pageSize: accountConfigPageSize,
        accountId: null,
        accountName: null,
        status: "ON",
      }),
    });
    if (!response.ok) {
      throw new Error(`IQIYI_DRAMA_ACCOUNT_CONFIG_REQUEST_FAILED: status=${response.status}`);
    }

    const payload = iqiyiAccountConfigPageResponseSchema.parse(await response.json());
    if (payload.code !== 0) {
      throw new Error(
        `IQIYI_DRAMA_ACCOUNT_CONFIG_REQUEST_FAILED: code=${payload.code} `
          + `message=${payload.msg || "-"}`,
      );
    }
    if (!payload.data) throw new Error("IQIYI_DRAMA_ACCOUNT_CONFIG_RESPONSE_DATA_REQUIRED");

    const pageAccounts = payload.data.data;
    fetchedAccounts.push(...pageAccounts);
    if (
      pageAccounts.length < accountConfigPageSize
      || (payload.data.total !== undefined && fetchedAccounts.length >= payload.data.total)
    ) {
      break;
    }
    page += 1;
  }

  const uniqueAccounts = new Map<string, IqiyiDramaAccount>();
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
