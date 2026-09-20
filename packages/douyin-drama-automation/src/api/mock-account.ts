import type { DouyinDramaAccount } from "./account-config.js";

export const DOUYIN_DRAMA_MOCK_ACCOUNT_ID = "17732354154";

export function isMockDouyinDramaAccountId(accountId: string | undefined) {
  return accountId?.trim() === DOUYIN_DRAMA_MOCK_ACCOUNT_ID;
}

/**
 * 抖音账号接口开发期间使用的临时假数据。
 *
 * 正式账号接口可用后，删除此文件以及 Electron 启动流程中的回退调用即可。
 */
export function createMockDouyinDramaAccounts(): DouyinDramaAccount[] {
  return [
    {
      id: 90_001,
      accountId: DOUYIN_DRAMA_MOCK_ACCOUNT_ID,
      accountName: DOUYIN_DRAMA_MOCK_ACCOUNT_ID,
      loginAccount: DOUYIN_DRAMA_MOCK_ACCOUNT_ID,
      rpaProfileKey: "douyin-drama-17732354154",
    },
  ];
}
