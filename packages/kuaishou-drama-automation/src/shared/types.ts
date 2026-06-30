import { z } from "zod";

export type KuaishouDramaLoginState = "login-required" | "logged-in" | "unknown";

export const kuaishouDramaGenderChannelValues = ["男频", "女频", "不限"] as const;
export const kuaishouDramaCategoryValues = [
  "脑洞",
  "甜宠",
  "逆袭",
  "热血",
  "复仇",
  "家庭",
  "乡村",
  "古风",
  "年代",
  "穿越",
  "悬疑",
  "武侠",
  "校园",
  "搞笑",
  "都市",
] as const;
export const kuaishouDramaPlotValues = [
  "豪门赘婿",
  "职场社畜",
  "异能奇遇",
  "麻雀变凤凰",
  "灰姑娘",
  "破镜重圆",
  "总裁追爱",
  "三教九流",
  "契约爱情",
  "总裁除恶",
  "战神归来",
  "守护家人",
  "东山再起",
  "世道人伦",
  "生活喜剧",
  "家庭伦理",
  "商海谍战",
  "江湖帮派",
  "乡村喜剧",
  "乡村文艺",
  "懵懂纯爱",
  "成长奋斗",
  "民国爱情",
  "战争谍报",
  "家宅传承",
  "军阀乱世",
  "正史传记",
  "传奇演义",
  "王朝架空",
  "门阀宅斗",
  "浪漫爱情",
  "修仙",
  "武侠",
  "西方魔幻",
  "东方魔幻",
  "重生转世",
  "穿越",
  "系统流",
  "空间流",
  "末世流",
  "灾难流",
  "星际流",
  "机甲流",
  "野村志怪",
  "探险生存",
  "诡秘悬疑",
  "警匪探案",
  "豪门儿媳",
  "其他",
] as const;
export const kuaishouDramaContentTypeValues = ["短剧", "漫剧"] as const;
export const kuaishouDramaProductionMethodValues = [
  "简笔动画",
  "小说剧",
  "AIGC剧",
  "沙雕动画",
  "3D动画",
  "2D动画",
] as const;
export const kuaishouDramaCopyrightProofTypeValues = ["自有版权", "授权版权"] as const;
export const kuaishouDramaCopyrightMaterialValues = [
  "作品登记证书",
  "短剧制作协议/权属声明",
  "现场拍摄图/短剧工程文件",
  "可信时间戳认证证书",
] as const;
export const kuaishouDramaYesNoValues = ["是", "否"] as const;
export const kuaishouDramaBroadcastPathValues = ["小屏小程序", "小屏APP", "PC端"] as const;
export const kuaishouDramaPersonGenderValues = ["男", "女"] as const;

const requiredText = z.string().trim().min(1);
const requiredRemoteUrl = z.string().trim().url();
const dateTextSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatDate(value: Date) {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

function oneYearLater(value: Date) {
  const next = new Date(value);
  next.setFullYear(next.getFullYear() + 1);
  return next;
}

const kuaishouDramaTaskBaseSchema = z.object({
  title: requiredText.max(30),
  coverImageUrl: requiredRemoteUrl,
  summary: requiredText.min(100).max(400),
  genderChannel: z.enum(kuaishouDramaGenderChannelValues),
  categories: z.array(z.enum(kuaishouDramaCategoryValues)).min(1).max(3),
  plotTags: z.array(z.enum(kuaishouDramaPlotValues)).min(1),
  contentType: z.enum(kuaishouDramaContentTypeValues).default("漫剧"),
  productionMethod: z.enum(kuaishouDramaProductionMethodValues).default("AIGC剧"),
  isCompleted: z.enum(kuaishouDramaYesNoValues).default("是"),
  fullSceneDisplay: z.enum(kuaishouDramaYesNoValues).default("是"),
  copyrightProofType: z.enum(kuaishouDramaCopyrightProofTypeValues).default("授权版权"),
  authorizationPromotionFileUrl: requiredRemoteUrl,
  copyrightMaterials: z
    .array(z.enum(kuaishouDramaCopyrightMaterialValues))
    .min(1)
    .default(["短剧制作协议/权属声明"]),
  copyrightDeclarationFileUrl: requiredRemoteUrl,
  copyrightValidityStartDate: dateTextSchema.optional(),
  copyrightValidityEndDate: dateTextSchema.optional(),
  sublicensingRight: z.enum(kuaishouDramaYesNoValues).default("否"),
  hasRecordNumber: z.enum(kuaishouDramaYesNoValues).default("否"),
  actorName: requiredText.default("张三"),
  actorGender: z.enum(kuaishouDramaPersonGenderValues).default("男"),
  actorRole: requiredText.default("主角"),
  productionYear: z.coerce.number().int().min(1900).max(2100).optional(),
  productionCostWan: z.coerce.number().positive().default(1),
  averageEpisodeDurationMinutes: z.coerce.number().positive().default(1),
  posterImageUrl: requiredRemoteUrl,
  broadcastPlatform: requiredText.default("快手"),
  broadcastPaths: z
    .array(z.enum(kuaishouDramaBroadcastPathValues))
    .length(3)
    .refine((values) => new Set(values).size === values.length, {
      message: "broadcastPaths cannot contain duplicate values",
    })
    .default(["小屏小程序", "小屏APP", "PC端"]),
  broadcastDate: dateTextSchema.optional(),
  directorName: requiredText.default("随便输入"),
  directorGender: z.enum(kuaishouDramaPersonGenderValues).default("男"),
  screenwriterName: requiredText.default("随便输入"),
  screenwriterGender: z.enum(kuaishouDramaPersonGenderValues).default("男"),
  producerName: requiredText.default("随便输入"),
  producerGender: z.enum(kuaishouDramaPersonGenderValues).default("男"),
  productionOrganization: requiredText,
  specialSubjectInvolved: z.enum(kuaishouDramaYesNoValues).default("否"),
}).superRefine((taskConfig, context) => {
  if (
    taskConfig.copyrightValidityStartDate &&
    taskConfig.copyrightValidityEndDate &&
    taskConfig.copyrightValidityEndDate < taskConfig.copyrightValidityStartDate
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["copyrightValidityEndDate"],
      message: "copyrightValidityEndDate cannot be earlier than copyrightValidityStartDate",
    });
  }
});

export const kuaishouDramaTaskSchema = kuaishouDramaTaskBaseSchema.transform((taskConfig) => {
  const today = new Date();
  return {
    ...taskConfig,
    copyrightValidityStartDate: taskConfig.copyrightValidityStartDate ?? formatDate(today),
    copyrightValidityEndDate: taskConfig.copyrightValidityEndDate ?? formatDate(oneYearLater(today)),
    broadcastDate: taskConfig.broadcastDate ?? formatDate(today),
    productionYear: taskConfig.productionYear ?? today.getFullYear(),
  };
});

export type KuaishouDramaGenderChannel = z.infer<typeof kuaishouDramaTaskBaseSchema>["genderChannel"];
export type KuaishouDramaCategory = z.infer<typeof kuaishouDramaTaskBaseSchema>["categories"][number];
export type KuaishouDramaPlot = z.infer<typeof kuaishouDramaTaskBaseSchema>["plotTags"][number];
export type KuaishouDramaContentType = z.infer<typeof kuaishouDramaTaskBaseSchema>["contentType"];
export type KuaishouDramaProductionMethod = z.infer<
  typeof kuaishouDramaTaskBaseSchema
>["productionMethod"];
export type KuaishouDramaCopyrightProofType = z.infer<
  typeof kuaishouDramaTaskBaseSchema
>["copyrightProofType"];
export type KuaishouDramaCopyrightMaterial = z.infer<
  typeof kuaishouDramaTaskBaseSchema
>["copyrightMaterials"][number];
export type KuaishouDramaYesNo = z.infer<typeof kuaishouDramaTaskBaseSchema>["isCompleted"];
export type KuaishouDramaBroadcastPath = z.infer<
  typeof kuaishouDramaTaskBaseSchema
>["broadcastPaths"][number];
export type KuaishouDramaPersonGender = z.infer<typeof kuaishouDramaTaskBaseSchema>["actorGender"];
export type KuaishouDramaTaskInput = z.input<typeof kuaishouDramaTaskSchema>;
export type KuaishouDramaTaskConfig = z.infer<typeof kuaishouDramaTaskSchema>;

export interface KuaishouDramaBrowserOptions {
  userDataDir?: string;
  headless?: boolean;
  slowMo?: number;
  keepOpenAfterRun?: boolean;
  keepOpenOnError?: boolean;
}

export type KuaishouDramaConfig = Partial<KuaishouDramaTaskInput> & {
  browser?: KuaishouDramaBrowserOptions;
  dryRun?: boolean;
  accountProfileName?: string;
  logRetentionDays?: string;
  task?: KuaishouDramaTaskInput;
  publish?: {
    submit?: boolean;
  };
};

export type KuaishouDramaRuntimeStatus = {
  platform: "kuaishou-drama";
  running: boolean;
  loginState: KuaishouDramaLoginState;
  activeUrl?: string;
  userDataDir: string;
  accountProfileName?: string;
  accountDir?: string;
  credentialStatePath?: string;
  assetDownloadDir?: string;
  logFilePath?: string;
};

export type KuaishouDramaRuntimeOptions = {
  config?: KuaishouDramaConfig;
  userDataDir?: string;
  accountProfileName?: string;
  accountDir?: string;
  credentialStatePath?: string;
  assetDownloadDir?: string;
  logFilePath?: string;
  logRetentionDays?: number;
  onLog?: (message: string) => void;
};

export type KuaishouDramaRuntime = {
  getStatus: () => KuaishouDramaRuntimeStatus;
  stop: () => Promise<void>;
};
