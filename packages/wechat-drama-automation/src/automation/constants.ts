import type {
  CopyrightVerificationMethod,
  DramaType,
  Monetization,
  QualificationType,
  SubmissionIdentity,
} from "../shared/types.js";

export const playletUrl = "https://channels.weixin.qq.com/platform/playlet";
export const postUrl = "https://channels.weixin.qq.com/platform/native-drama-post";
export const rootSelector = "wujie-app";
export const auditFormSelector = `${rootSelector} form.audit-form`;

export const selectors = {
  dramaName: `${rootSelector} input[placeholder="请填写待提审剧目的名称"]`,
  summary: `${rootSelector} textarea[placeholder="请介绍相关剧情概要，便于用户更好地了解作品内容"]`,
  recommendation: `${rootSelector} input[placeholder="选填，请给出剧目推荐理由，该内容后续将在特定场景向用户展示"]`,
  episodeCount: `${rootSelector} input[placeholder="请填写待提审剧目的总剧集数量（注：提交审核后不支持变更剧集数量）"]`,
  previewEpisodeCount: `${rootSelector} input[placeholder="请填写试看集数"]`,
  producerName: `${rootSelector} input[placeholder="请填写待提审剧目的制作方主体名称"]`,
  qualificationNumber: `${rootSelector} input[placeholder="请填写网络剧片发行许可证号或16位备案号"]`,
  agreement: `${rootSelector} .form_footer input[type="checkbox"]`,
} as const;

export const monetizationValues: Record<Monetization, string> = {
  "IAA广告变现": "1",
  "IAP付费变现": "2",
};

export const dramaTypeValues: Record<DramaType, string> = {
  "真人": "2",
  "数字真人": "3",
  "漫剧": "1",
};

export const submissionIdentityValues: Record<SubmissionIdentity, string> = {
  "剧目制作方": "1",
  "版权方/授权播出方": "2",
};

export const qualificationValues: Record<QualificationType, string> = {
  "重点/普通微短剧": "1",
  "其他微短剧": "2",
};

export const copyrightVerificationValues: Record<CopyrightVerificationMethod, string> = {
  "基于版权证明材料": "1",
  "基于版权授权关系": "2",
};

export function formGroup(index: number): string {
  return `${auditFormSelector} > .weui-desktop-form__control-group:nth-of-type(${index})`;
}
