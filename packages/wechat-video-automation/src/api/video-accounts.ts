import { httpClient } from "./http-client.js";

export interface VideoAccount {
  id: string;
  name: string;
  contractSubject?: string;
}

interface VideoAccountRecord {
  id: number;
  videoAccountId: string;
  videoAccountName: string;
  loginAccount: string;
  rpaProfileKey: string;
  contractSubject?: string | null;
  sortNo: number;
  status: "ON" | "OFF";
  remark?: string;
  createUid: number;
  updateUid: number;
  createTime: string;
  updateTime: string;
}

interface VideoAccountPageResponse {
  code: number;
  msg: string;
  data?: {
    total: number;
    data: VideoAccountRecord[];
  };
}

export async function fetchVideoAccountsApi(): Promise<VideoAccount[]> {
  const response = await httpClient.post<VideoAccountPageResponse>(
    "/dramaAiRpa/videoAccountConfig/page",
    {
      page: 1,
      pageSize: 100,
      status: "ON",
    },
  );
  const payload = response.data;

  if (payload.code !== 0) {
    throw new Error(`Failed to fetch video accounts: ${payload.msg || `code=${payload.code}`}`);
  }
  const records = payload.data?.data;
  if (!Array.isArray(records)) {
    throw new Error("Video account page response data.data is required.");
  }

  return records.map((record, index) => {
    if (!record.videoAccountId || !record.videoAccountName) {
      throw new Error(`Video account record at index ${index} requires videoAccountId and videoAccountName.`);
    }
    return {
      id: record.videoAccountId,
      name: record.videoAccountName,
      contractSubject: record.contractSubject ?? undefined,
    };
  });
}
