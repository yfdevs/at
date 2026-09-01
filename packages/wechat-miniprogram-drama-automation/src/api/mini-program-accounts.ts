export interface WechatMiniProgramAccount {
  id: string;
  name: string;
  loginAccount?: string;
  rpaProfileKey?: string;
  contractSubject?: string;
}

interface WechatMiniProgramAccountRecord {
  id: number;
  accountId: string;
  accountName: string;
  loginAccount: string;
  rpaProfileKey: string;
  sortNo: number;
  status: "ON" | "OFF";
  remark?: string;
  createTime: string;
  updateTime: string;
}

interface WechatMiniProgramAccountPageResponse {
  code: number;
  msg: string;
  data?: {
    total: number;
    data: WechatMiniProgramAccountRecord[];
  };
}

async function requestWechatMiniProgramAccountPage(): Promise<WechatMiniProgramAccountPageResponse> {
  // TODO: 小程序账号正式接口可用后，只替换此方法，调用方无需调整。
  return {
    code: 0,
    msg: "操作成功",
    data: {
      total: 1,
      data: [
        {
          id: 10_002,
          accountId: "wxmp-mock-002",
          accountName: "微信小程序测试账号 02",
          loginAccount: "wxmp_mock_login_02",
          rpaProfileKey: "wechat-miniprogram-mock-002",
          sortNo: 2,
          status: "ON",
          remark: "小程序账号接口占位数据",
          createTime: "2026-08-31 00:00:00",
          updateTime: "2026-08-31 00:00:00",
        },
      ],
    },
  };
}

export async function fetchWechatMiniProgramAccountsApi(): Promise<WechatMiniProgramAccount[]> {
  const payload = await requestWechatMiniProgramAccountPage();
  if (payload.code !== 0) {
    throw new Error(`微信小程序账号获取失败：${payload.msg || `code=${payload.code}`}`);
  }

  const records = payload.data?.data;
  if (!Array.isArray(records)) {
    throw new Error("微信小程序账号响应缺少 data.data");
  }

  return records
    .filter((record) => record.status === "ON")
    .sort((left, right) => left.sortNo - right.sortNo)
    .map((record, index) => {
      if (!record.accountId.trim() || !record.accountName.trim()) {
        throw new Error(`微信小程序账号第 ${index + 1} 项缺少 accountId 或 accountName`);
      }
      return {
        id: record.accountId.trim(),
        name: record.accountName.trim(),
        loginAccount: record.loginAccount.trim() || undefined,
        rpaProfileKey: record.rpaProfileKey.trim() || undefined,
      };
    });
}
