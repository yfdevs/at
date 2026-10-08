export const DOUYIN_DRAMA_PLATFORM = "douyin-drama" as const;

export const DOUYIN_DRAMA_CREATE_URL =
  "https://www.shortdramas.com/page/copyright/short-play/motion-comic-manage-edit-page/?from=book";

export const DOUYIN_DRAMA_LOGIN_URL =
  "https://www.shortdramas.com/page/login?redirect=%2Fcopyright%2Fshort-play%2Fmotion-comic-manage-edit-page%2F%3Ffrom%3Dbook";

export const DOUYIN_DRAMA_PRODUCTION_TEAM = "明星说(北京)科技有限公司";
export const DOUYIN_DRAMA_CREATOR_NAME = "明星说";
export const DOUYIN_DRAMA_AIGC_TOOL = "红果漫剧创作Agent";
export const DOUYIN_DRAMA_SERIES_TYPE = "季播剧";
export const DOUYIN_DRAMA_UPDATE_STATUS = "已完结" as const;
export const DOUYIN_DRAMA_PRODUCTION_COST_RANGE = "30万以下" as const;
export const DOUYIN_DRAMA_CONTRACT_NAMES = [
  "CT20260928151015 漫剧合作协议（对公签约-番茄 IP 改编）-明星说北京科技有限公司",
  "CT20260521191189 【明星说】漫剧合作协议（框架）",
  "CT20251230112335 动态漫授权合作协议(对公签约-付免一体-普通授权-纯分成）- 主协议-明星说北京科技有限公司",
  "CT20251231125707 动态漫IP授权合作协议(对公签约-纯分成-动态漫版权共有) - 主协议-明星说北京科技有限公司",
  "CT20251127121461 动态漫授权合作协议(对公签约-付免一体-普通授权-纯分成）- 主协议-明星说北京科技有限公司",
] as const;
export const DOUYIN_DRAMA_FRAMEWORK_CONTRACT_ID = "CT20260521191189" as const;
export const DOUYIN_DRAMA_FRAMEWORK_CONTRACT_NAME = DOUYIN_DRAMA_CONTRACT_NAMES[1];
export const DOUYIN_DRAMA_STANDARD_CONTRACT_NAME =
  "动态漫授权合作协议(对公签约-付免一体-普通授权-纯分成）- 主协议-明星说北京科技有限公司" as const;

export const DOUYIN_DRAMA_HONGGUO_COVER = {
  aspectRatio: 7 / 10,
  height: 1_000,
  width: 700,
} as const;

export const DOUYIN_DRAMA_DOUYIN_COVER = {
  aspectRatio: 2 / 3,
  height: 1_080,
  width: 720,
} as const;
