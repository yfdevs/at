import { z } from "zod";

const accountSchema = z.object({
  id: z.coerce.number().int(),
  accountId: z.string().trim().min(1),
  accountName: z.string().trim().min(1),
  loginAccount: z.string().nullish(),
  rpaProfileKey: z.string().nullish(),
  sortNo: z.coerce.number().optional(),
  status: z.string(),
});

const pageResponseSchema = z.object({
  code: z.number(),
  msg: z.string().nullish(),
  data: z
    .object({
      total: z.coerce.number().int().nonnegative().optional(),
      data: z.array(accountSchema),
    })
    .nullish(),
});

export type KuaishouDramaAccount = {
  id: number;
  accountId: string;
  accountName: string;
  loginAccount?: string | null;
  rpaProfileKey?: string | null;
};

const pageSize = 100;

export async function fetchKuaishouDramaAccounts(
  apiBaseUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<KuaishouDramaAccount[]> {
  const baseUrl = apiBaseUrl.trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("KUAISHOU_DRAMA_API_BASE_URL_REQUIRED");

  const fetched: z.infer<typeof accountSchema>[] = [];
  for (let page = 1; ; page += 1) {
    const response = await fetcher(`${baseUrl}/dramaAiRpa/kuaishou/accountConfig/page`, {
      method: "POST",
      headers: {
        accept: "application/json, text/plain, */*",
        "content-type": "application/json;charset=UTF-8",
      },
      body: JSON.stringify({ page, pageSize, accountId: null, accountName: null, status: "ON" }),
    });
    if (!response.ok) {
      throw new Error(`KUAISHOU_DRAMA_ACCOUNT_CONFIG_REQUEST_FAILED: status=${response.status}`);
    }
    const payload = pageResponseSchema.parse(await response.json());
    if (payload.code !== 0) {
      throw new Error(
        `KUAISHOU_DRAMA_ACCOUNT_CONFIG_REQUEST_FAILED: code=${payload.code} ` +
          `message=${payload.msg || "-"}`,
      );
    }
    if (!payload.data) throw new Error("KUAISHOU_DRAMA_ACCOUNT_CONFIG_RESPONSE_DATA_REQUIRED");
    fetched.push(...payload.data.data);
    if (
      payload.data.data.length < pageSize ||
      (payload.data.total !== undefined && fetched.length >= payload.data.total)
    )
      break;
  }

  const unique = new Map<string, KuaishouDramaAccount>();
  for (const account of fetched
    .filter((item) => item.status === "ON")
    .sort((left, right) => (left.sortNo ?? 0) - (right.sortNo ?? 0))) {
    unique.set(account.accountId, {
      id: account.id,
      accountId: account.accountId,
      accountName: account.accountName,
      loginAccount: account.loginAccount,
      rpaProfileKey: account.rpaProfileKey,
    });
  }
  return [...unique.values()];
}
