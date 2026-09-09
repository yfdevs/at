export type TencentHuolongDramaAccount = {
  id: number;
  accountId: string;
  accountName: string;
  loginAccount?: string | null;
  rpaProfileKey?: string | null;
};

const localMockAccounts: readonly TencentHuolongDramaAccount[] = [
  {
    id: 1,
    accountId: "default",
    accountName: "腾讯火龙漫剧本地账号",
    loginAccount: null,
    rpaProfileKey: "default",
  },
];

export function getLocalTencentHuolongDramaAccounts(): TencentHuolongDramaAccount[] {
  return localMockAccounts.map((account) => ({ ...account }));
}

export function fetchTencentHuolongDramaAccounts(
  _apiBaseUrl: string,
  _fetcher: typeof fetch = fetch,
): Promise<TencentHuolongDramaAccount[]> {
  // TODO: 后端接口可用后，在这里替换为真实的账号配置请求。
  return Promise.resolve(getLocalTencentHuolongDramaAccounts());
}
