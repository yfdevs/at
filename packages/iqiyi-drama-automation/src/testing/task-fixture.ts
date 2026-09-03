import type { ClaimedIqiyiDramaTask } from "../shared/types.js";

export function createIqiyiDramaTaskFixture(): ClaimedIqiyiDramaTask {
  return {
    accountTaskId: 88,
    dramaId: 1465,
    originalTitle: "爱奇艺自动化测试剧",
    iqiyiAccountId: "iqiyi-account-1",
    iqiyiAccountName: "爱奇艺账号一",
    playlet: {
      dramaType: "short-drama",
      title: "爱奇艺自动化测试剧",
      summary:
        "青年顾川回到故乡接手濒临停业的小店，在修缮老屋与寻找家族旧物的过程中，逐步化解邻里误会，也发现父辈当年隐瞒的真相。面对收购压力、亲情裂痕与事业选择，他联合伙伴守住社区烟火，让沉寂多年的街巷重新焕发生机，也终于找到属于自己的生活方向。",
      episodeCount: 82,
      copyright: {
        productionProofFiles: [],
        licenseProofFiles: [],
      },
      audienceType: "男频",
      visualType: "AI剧",
      primaryCategory: "家庭伦理",
      secondaryCategories: ["都市日常", "逆袭"],
      productionOrganization: "测试制作方",
      productionCostYuan: 10_000,
      contentSource: "小说改编",
    },
  };
}
