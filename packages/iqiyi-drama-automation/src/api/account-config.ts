export type IqiyiDramaAccount = {
  id: number;
  accountId: string;
  accountName: string;
  loginAccount?: string | null;
  rpaProfileKey?: string | null;
};

export function createMockIqiyiDramaAccounts(): IqiyiDramaAccount[] {
  return [{
    id: 1,
    accountId: "iqiyi-drama-test-account",
    accountName: "爱奇艺漫剧测试账号",
    loginAccount: null,
    rpaProfileKey: "iqiyi-drama-test-account",
  }];
}

// 后端接口尚未提供。正式账号配置接口接入后，只替换此方法内部。
export async function fetchIqiyiDramaAccounts(
  apiBaseUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<IqiyiDramaAccount[]> {
  void apiBaseUrl;
  void fetcher;
  return createMockIqiyiDramaAccounts();
}
