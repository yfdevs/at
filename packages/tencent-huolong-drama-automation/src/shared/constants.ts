export const TENCENT_HUOLONG_DRAMA_PLATFORM = "tencent-huolong-drama";
export const TENCENT_HUOLONG_DRAMA_ADD_URL = "https://mp.v.qq.com/kairos/album/create";
export const TENCENT_HUOLONG_DRAMA_LOGIN_URL = "https://mp.v.qq.com/";

export const tencentHuolongThemeOptionValues = [
  ["玄幻", "123134900"],
  ["异能", "123134901"],
  ["武侠", "123134902"],
  ["仙侠", "123134903"],
  ["都市", "123134904"],
  ["历史", "123134905"],
  ["悬疑", "123134906"],
  ["末世", "123134907"],
  ["重生", "123134908"],
  ["穿越", "123134909"],
  ["系统", "123134910"],
  ["搞笑", "123134911"],
  ["灵异", "123134912"],
  ["古风", "123134913"],
  ["青春", "123134914"],
  ["言情", "123134915"],
] as const;

export const tencentHuolongThemeValues = tencentHuolongThemeOptionValues.map(
  ([label]) => label,
) as [
  "玄幻", "异能", "武侠", "仙侠", "都市", "历史", "悬疑", "末世",
  "重生", "穿越", "系统", "搞笑", "灵异", "古风", "青春", "言情",
];

export const tencentHuolongThemeOptionId = Object.fromEntries(
  tencentHuolongThemeOptionValues,
) as Record<(typeof tencentHuolongThemeValues)[number], string>;
