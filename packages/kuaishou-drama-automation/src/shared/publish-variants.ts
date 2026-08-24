import type {
  KuaishouDramaPublishVariant,
  KuaishouDramaTaskConfig,
} from "./types.js";

function withoutBookTitleMarks(title: string) {
  return title.trim().replace(/^《+/, "").replace(/》+$/, "").trim();
}

export function createKuaishouDramaPublishVariants(
  task: KuaishouDramaTaskConfig,
): [KuaishouDramaPublishVariant, KuaishouDramaPublishVariant] {
  const lastEpisode = task.episodeCount;
  const fullPaidFreeEnd = Math.min(7, lastEpisode);
  const fullPaidRanges: KuaishouDramaPublishVariant["episodePriceRanges"] = [
    { startEpisode: 1, endEpisode: fullPaidFreeEnd, price: "免费" },
  ];
  if (lastEpisode >= 8) {
    fullPaidRanges.push({ startEpisode: 8, endEpisode: lastEpisode, price: "付费" });
  }

  const adUnlockRanges: KuaishouDramaPublishVariant["episodePriceRanges"] = [
    { startEpisode: 1, endEpisode: 1, price: "免费" },
  ];
  if (lastEpisode >= 2) {
    adUnlockRanges.push({ startEpisode: 2, endEpisode: lastEpisode, price: "付费" });
  }

  return [
    {
      kind: "full-paid",
      title: task.title,
      saleMode: "全剧付费",
      fullDramaPriceYuan: task.fullDramaPriceYuan,
      episodePriceRanges: fullPaidRanges,
    },
    {
      kind: "ad-unlock",
      title: `《${withoutBookTitleMarks(task.title)}》`,
      saleMode: "观看广告解锁",
      episodePriceRanges: adUnlockRanges,
    },
  ];
}
