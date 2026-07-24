import { z } from "zod";
import type { MeituanCreationAccount } from "../shared/types.js";

const accountConfigSchema = z.object({
  id: z.coerce.number().int(),
  accountId: z.string().trim().min(1),
  accountName: z.string().trim().min(1),
  loginAccount: z.string().nullable().optional(),
  rpaProfileKey: z.string().nullable().optional(),
  sortNo: z.coerce.number().optional(),
  status: z.string(),
});

const responseSchema = z.object({
  code: z.number(),
  msg: z.string().nullish(),
  data: z.object({
    data: z.array(accountConfigSchema),
  }).nullish(),
});

function accountConfigPageUrl(apiBaseUrl: string) {
  const baseUrl = apiBaseUrl.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("MEITUAN_API_BASE_URL_REQUIRED");
  }
  return `${baseUrl}/dramaAiRpa/meituan/accountConfig/page`;
}

export async function fetchMeituanCreationAccounts(
  apiBaseUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<MeituanCreationAccount[]> {
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
    throw new Error(`MEITUAN_ACCOUNT_CONFIG_REQUEST_FAILED: status=${response.status}`);
  }

  const payload = responseSchema.parse(await response.json());
  if (payload.code !== 0) {
    throw new Error(
      `MEITUAN_ACCOUNT_CONFIG_REQUEST_FAILED: code=${payload.code} message=${payload.msg || "-"}`,
    );
  }

  if (!payload.data) {
    throw new Error("MEITUAN_ACCOUNT_CONFIG_RESPONSE_DATA_REQUIRED");
  }

  const enabledAccounts = payload.data.data
    .filter((account) => account.status === "ON")
    .sort((left, right) => (left.sortNo ?? 0) - (right.sortNo ?? 0));
  const uniqueAccounts = new Map<string, MeituanCreationAccount>();
  for (const account of enabledAccounts) {
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
