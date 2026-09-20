import type { ClaimedTencentHuolongDramaTask } from "../../src/shared/types.js";

export function createTencentHuolongTaskFixture(): ClaimedTencentHuolongDramaTask {
  return {
    accountTaskId: 88,
    dramaId: 1465,
    originalTitle: "车位风波",
    accountId: "tencent-account-1",
    accountName: "火龙账号一",
    playlet: {
      title: "车位风波",
      summary:
        "沈悦因车位被占和家人发生冲突，最终学会依靠规则维护权益，也理解了家人之间坦诚沟通的重要性。",
      episodeCount: 40,
      baiduPanResourceLink: "https://pan.baidu.com/s/example?pwd=test",
      protagonistName: "沈悦",
      isAiRealPersonShortDrama: "否",
      themeType: "都市",
      keywords: ["都市", "情感"],
      costAnalysisFiles: ["https://files.example.test/cost.pdf"],
      copyrightProofFiles: ["https://files.example.test/copyright.pdf"],
      productionProcessFiles: ["https://files.example.test/process-01.jpg"],
    },
  };
}
