import { httpClient } from "./http-client.js";

export interface DramaAiRpaDetailResponse {
  data?: {
    dataJson?: unknown;
  };
}

export async function fetchDramaAiRpaDetailApi(id: string): Promise<DramaAiRpaDetailResponse> {
  return httpClient.get<DramaAiRpaDetailResponse>(
    `/dramaAiRpa/detail/${encodeURIComponent(id)}`,
  );
}
