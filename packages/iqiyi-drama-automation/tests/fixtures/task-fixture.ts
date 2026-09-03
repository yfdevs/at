import type { ClaimedIqiyiDramaTask } from "../../src/shared/types.js";

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
        productionProofFiles: ["https://example.com/iqiyi-production-proof.pdf"],
      },
      audienceType: "男频",
      secondaryCategories: ["都市", "逆袭"],
      productionOrganization: "测试制作方",
      productionCostYuan: 10_000,
      paymentStatus: "付费",
      convertibleToFree: "是",
      paidStartEpisode: 10,
    },
  };
}

export function createIqiyiComicDramaTaskFixture(): ClaimedIqiyiDramaTask {
  const fixture = createIqiyiDramaTaskFixture();
  return {
    ...fixture,
    playlet: {
      dramaType: "comic-drama",
      title: fixture.playlet.title,
      summary: fixture.playlet.summary,
      episodeCount: fixture.playlet.episodeCount,
      copyright: fixture.playlet.copyright,
      audienceType: "男频",
      visualType: "AI剧",
      contentSource: "小说改编",
      secondaryCategories: ["大女主", "搞笑"],
      productionOrganization: fixture.playlet.productionOrganization,
      productionCostYuan: fixture.playlet.productionCostYuan,
    },
  };
}
