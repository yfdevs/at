import { z } from "zod";

const qqAccountConfigSchema = z.object({
  id: z.coerce.number().int(),
  accountId: z.string().trim().min(1),
  accountName: z.string().trim().min(1),
  loginAccount: z.string().nullish(),
  rpaProfileKey: z.string().nullish(),
  sortNo: z.coerce.number().optional(),
  status: z.string(),
});

const qqAccountConfigPageResponseSchema = z.object({
  code: z.number(),
  msg: z.string().nullish(),
  data: z.object({
    data: z.array(qqAccountConfigSchema),
  }).nullish(),
});

export type QqDramaAccount = {
  id: number;
  accountId: string;
  accountName: string;
  loginAccount?: string | null;
  rpaProfileKey?: string | null;
};

function accountConfigPageUrl(apiBaseUrl: string) {
  const baseUrl = apiBaseUrl.trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("QQ_DRAMA_API_BASE_URL_REQUIRED");
  return `${baseUrl}/dramaAiRpa/qq/accountConfig/page`;
}

export async function fetchQqDramaAccounts(
  apiBaseUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<QqDramaAccount[]> {
  const response = await fetcher(accountConfigPageUrl(apiBaseUrl), {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json;charset=UTF-8",
    },
    body: JSON.stringify({
      page: 1,
      pageSize: 1000,
      accountId: null,
      accountName: null,
      status: "ON",
    }),
  });

  if (!response.ok) {
    throw new Error(`QQ_DRAMA_ACCOUNT_CONFIG_REQUEST_FAILED: status=${response.status}`);
  }

  const payload = qqAccountConfigPageResponseSchema.parse(await response.json());
  if (payload.code !== 0) {
    throw new Error(
      `QQ_DRAMA_ACCOUNT_CONFIG_REQUEST_FAILED: code=${payload.code} message=${payload.msg || "-"}`,
    );
  }
  if (!payload.data) {
    throw new Error("QQ_DRAMA_ACCOUNT_CONFIG_RESPONSE_DATA_REQUIRED");
  }

  const uniqueAccounts = new Map<string, QqDramaAccount>();
  for (const account of payload.data.data
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
