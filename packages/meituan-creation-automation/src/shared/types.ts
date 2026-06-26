import { z } from "zod";

const requiredText = z.string().trim().min(1);
const requiredUrl = z.string().trim().url();
const audienceSchema = z.union([z.literal("男频"), z.literal("女频")]);
const backgroundSchema = z.union([
  z.literal("现代"),
  z.literal("都市"),
  z.literal("古代"),
  z.literal("乡村"),
  z.literal("年代"),
  z.literal("架空"),
  z.literal("职场"),
  z.literal("民国"),
  z.literal("宫廷"),
  z.literal("校园"),
  z.literal("荒岛"),
  z.literal("古装"),
  z.literal("末世")
]);
const plotSettingSchema = z.union([
  z.literal("打脸虐渣"),
  z.literal("大男主"),
  z.literal("大女主"),
  z.literal("马甲"),
  z.literal("重生"),
  z.literal("穿越"),
  z.literal("系统"),
  z.literal("先婚后爱"),
  z.literal("家长里短"),
  z.literal("小人物"),
  z.literal("神豪"),
  z.literal("金手指"),
  z.literal("猛兽"),
  z.literal("豪门"),
  z.literal("破镜重圆"),
  z.literal("强者回归"),
  z.literal("传承觉醒"),
  z.literal("异能"),
  z.literal("强强联合"),
  z.literal("逆袭"),
  z.literal("医生"),
  z.literal("甜宠"),
  z.literal("娱乐圈"),
  z.literal("青梅竹马"),
  z.literal("神医"),
  z.literal("追妻火葬场"),
  z.literal("姐弟恋"),
  z.literal("玄学"),
  z.literal("业界精英"),
  z.literal("萌娃"),
  z.literal("一见钟情"),
  z.literal("反派主角"),
  z.literal("萌宠"),
  z.literal("捞偏门"),
  z.literal("白月光"),
  z.literal("双向救赎"),
  z.literal("灵魂互换"),
  z.literal("病娇"),
  z.literal("反转"),
  z.literal("暴富"),
  z.literal("黑道"),
  z.literal("丧尸"),
  z.literal("特种兵"),
  z.literal("霸总"),
  z.literal("方言")
]);
const storyThemeSchema = z.union([
  z.literal("脑洞"),
  z.literal("打脸虐渣"),
  z.literal("大男主"),
  z.literal("大女主"),
  z.literal("马甲"),
  z.literal("重生"),
  z.literal("穿越"),
  z.literal("系统"),
  z.literal("先婚后爱"),
  z.literal("家长里短"),
  z.literal("小人物"),
  z.literal("神豪"),
  z.literal("金手指"),
  z.literal("猛兽"),
  z.literal("豪门"),
  z.literal("破镜重圆"),
  z.literal("强者回归"),
  z.literal("传承觉醒"),
  z.literal("异能"),
  z.literal("强强联合"),
  z.literal("逆袭"),
  z.literal("医生"),
  z.literal("甜宠"),
  z.literal("娱乐圈"),
  z.literal("青梅竹马"),
  z.literal("神医"),
  z.literal("追妻火葬场"),
  z.literal("姐弟恋"),
  z.literal("玄学"),
  z.literal("业界精英"),
  z.literal("萌娃"),
  z.literal("一见钟情"),
  z.literal("反派主角"),
  z.literal("萌宠"),
  z.literal("捞偏门"),
  z.literal("白月光"),
  z.literal("双向救赎"),
  z.literal("灵魂互换"),
  z.literal("病娇"),
  z.literal("反转"),
  z.literal("暴富"),
  z.literal("黑道"),
  z.literal("丧尸"),
  z.literal("特种兵"),
  z.literal("霸总"),
  z.literal("方言")
]);
const premiereStatusSchema = z.union([
  z.literal("美团独家"),
  z.literal("美团联合首发"),
  z.literal("非美团首发")
]);
const commonTaskSchema = {
  authorNicknameText: requiredText,
  audience: audienceSchema,
  collectionTitle: requiredText,
  collectionCoverUrl: requiredUrl,
  copyrightProofUrl: requiredUrl,
  premiereProofUrl: requiredUrl,
  backgroundText: backgroundSchema,
  plotSettingTexts: z.array(plotSettingSchema).min(1).max(2),
  storyThemeText: storyThemeSchema,
  totalEpisodes: z.coerce.number().int().min(1),
  checkpointEpisodes: z.array(z.coerce.number().int().min(2)).min(1).max(3),
  productionCompanyText: requiredText,
  directorNames: z.array(requiredText).min(1),
  producerNames: z.array(requiredText).min(1),
  screenwriterNames: z.array(requiredText).min(1),
  actorNames: z.array(requiredText).min(1),
  averageEpisodeDurationMinutes: z.coerce.number().positive(),
  plotSynopsisText: requiredText,
  premiereStatus: premiereStatusSchema.default("美团联合首发"),
  expectedPremiereTimeText: requiredText
};

export const meituanCreationTaskSchema = z.discriminatedUnion("collectionType", [
  z.object({
    ...commonTaskSchema,
    collectionType: z.literal("真人短剧（含AI）"),
    collectionSubType: z.union([z.literal("真人短剧"), z.literal("AI真人短剧")])
  }),
  z.object({
    ...commonTaskSchema,
    collectionType: z.literal("动漫短剧"),
    collectionSubType: z.union([z.literal("动态漫"), z.literal("沙雕漫"), z.literal("PPT漫")])
  })
]).superRefine((taskConfig, context) => {
  for (const [index, episode] of taskConfig.checkpointEpisodes.entries()) {
    if (episode > taskConfig.totalEpisodes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checkpointEpisodes", index],
        message: "Checkpoint episode cannot exceed totalEpisodes"
      });
    }
  }
});

export type MeituanCreationAudience = z.infer<typeof meituanCreationTaskSchema>["audience"];
export type MeituanCreationCollectionType = z.infer<typeof meituanCreationTaskSchema>["collectionType"];
export type MeituanCreationCollectionSubType = z.infer<typeof meituanCreationTaskSchema>["collectionSubType"];
export type MeituanCreationBackground = z.infer<typeof meituanCreationTaskSchema>["backgroundText"];
export type MeituanCreationPlotSetting = z.infer<typeof meituanCreationTaskSchema>["plotSettingTexts"][number];
export type MeituanCreationStoryTheme = z.infer<typeof meituanCreationTaskSchema>["storyThemeText"];
export type MeituanCreationPremiereStatus = z.infer<typeof meituanCreationTaskSchema>["premiereStatus"];
export type MeituanCreationTaskConfig = z.infer<typeof meituanCreationTaskSchema>;

export interface MeituanCreationBrowserOptions {
  userDataDir?: string;
  headless?: boolean;
  slowMo?: number;
  keepOpenAfterRun?: boolean;
  keepOpenOnError?: boolean;
}

export interface MeituanCreationVideoDraft {
  videoFile?: string;
  title?: string;
  description?: string;
  tags?: string[];
}

export interface MeituanCreationConfig {
  browser?: MeituanCreationBrowserOptions;
  dryRun?: boolean;
  localEpisodeVideoRoot?: string;
  authorNicknameText?: string;
  audience?: MeituanCreationAudience;
  collectionType?: MeituanCreationCollectionType;
  collectionSubType?: MeituanCreationCollectionSubType;
  collectionTitle?: string;
  collectionCoverUrl?: string;
  copyrightProofUrl?: string;
  premiereProofUrl?: string;
  backgroundText?: MeituanCreationBackground;
  plotSettingTexts?: MeituanCreationPlotSetting[];
  storyThemeText?: MeituanCreationStoryTheme;
  totalEpisodes?: number | string;
  checkpointEpisodes?: Array<number | string>;
  productionCompanyText?: string;
  directorNames?: string[];
  producerNames?: string[];
  screenwriterNames?: string[];
  actorNames?: string[];
  averageEpisodeDurationMinutes?: number | string;
  plotSynopsisText?: string;
  premiereStatus?: MeituanCreationPremiereStatus;
  expectedPremiereTimeText?: string;
  publish?: {
    submit?: boolean;
  };
  video?: MeituanCreationVideoDraft;
}

export type MeituanCreationRuntimeStatus = {
  platform: "meituan-creation";
  loginUrl: string;
  publishVideoUrl: string;
  running: boolean;
  loginState: "login-required" | "logged-in" | "unknown";
  activeUrl?: string;
  userDataDir: string;
};

export type MeituanCreationRuntimeOptions = {
  config?: MeituanCreationConfig;
  userDataDir?: string;
  credentialStatePath?: string;
  assetDownloadDir?: string;
  onLog?: (message: string) => void;
};

export type MeituanCreationRuntime = {
  getStatus: () => MeituanCreationRuntimeStatus;
  stop: () => Promise<void>;
};
