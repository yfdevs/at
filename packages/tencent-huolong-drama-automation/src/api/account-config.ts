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

const responseSchema = z.object({
  code: z.number(),
  msg: z.string().nullish(),
  data: z.object({ total: z.coerce.number().int().optional(), data: z.array(accountSchema) }).nullish(),
});

export type TencentHuolongDramaAccount = {
  id: number;
  accountId: string;
  accountName: string;
  loginAccount?: string | null;
  rpaProfileKey?: string | null;
};

export async function fetchTencentHuolongDramaAccounts(
  apiBaseUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<TencentHuolongDramaAccount[]> {
  const baseUrl = apiBaseUrl.trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("TENCENT_HUOLONG_DRAMA_API_BASE_URL_REQUIRED");
  const response = await fetcher(`${baseUrl}/dramaAiRpa/tencent/accountConfig/page`, {
    method: "POST",
    headers: { "content-type": "application/json;charset=UTF-8" },
    body: JSON.stringify({ page: 1, pageSize: 100, accountId: null, accountName: null, status: "ON" }),
  });
  if (!response.ok) {
    throw new Error(`TENCENT_HUOLONG_DRAMA_ACCOUNT_CONFIG_REQUEST_FAILED: status=${response.status}`);
  }
  const payload = responseSchema.parse(await response.json());
  if (payload.code !== 0) {
    throw new Error(`TENCENT_HUOLONG_DRAMA_ACCOUNT_CONFIG_REQUEST_FAILED: code=${payload.code} message=${payload.msg || "-"}`);
  }
  if (!payload.data) throw new Error("TENCENT_HUOLONG_DRAMA_ACCOUNT_CONFIG_RESPONSE_DATA_REQUIRED");
  return payload.data.data
    .filter((account) => account.status === "ON")
    .sort((a, b) => (a.sortNo ?? 0) - (b.sortNo ?? 0))
    .map(({ id, accountId, accountName, loginAccount, rpaProfileKey }) => ({
      id, accountId, accountName, loginAccount, rpaProfileKey,
    }));
}
