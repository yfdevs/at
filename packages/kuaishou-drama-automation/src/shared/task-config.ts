import type {
  KuaishouDramaConfig,
  KuaishouDramaRuntimeOptions,
  KuaishouDramaTaskConfig,
  KuaishouDramaTaskInput,
} from "./types.js";
import { kuaishouDramaTaskSchema } from "./types.js";

const taskKeys: Array<keyof KuaishouDramaTaskInput> = [
  "title",
  "coverImageUrl",
  "summary",
  "genderChannel",
  "categories",
  "plotTags",
  "contentType",
  "productionMethod",
  "isCompleted",
  "fullSceneDisplay",
  "copyrightProofType",
  "authorizationPromotionFileUrl",
  "copyrightMaterials",
  "copyrightDeclarationFileUrl",
  "copyrightValidityStartDate",
  "copyrightValidityEndDate",
  "sublicensingRight",
  "hasRecordNumber",
  "actorName",
  "actorGender",
  "actorRole",
  "productionYear",
  "productionCostWan",
  "averageEpisodeDurationMinutes",
  "posterImageUrl",
  "broadcastPlatform",
  "broadcastPaths",
  "broadcastDate",
  "directorName",
  "directorGender",
  "screenwriterName",
  "screenwriterGender",
  "producerName",
  "producerGender",
  "productionOrganization",
  "specialSubjectInvolved",
];

function taskSource(
  config: KuaishouDramaConfig | undefined,
): Partial<KuaishouDramaTaskInput> | KuaishouDramaTaskInput | undefined {
  return config?.task ?? config;
}

function hasTaskConfig(config: KuaishouDramaConfig | undefined) {
  const task = taskSource(config);
  return Boolean(task && taskKeys.some((key) => task[key] !== undefined));
}

export function parseTaskConfig(
  options: KuaishouDramaRuntimeOptions,
): KuaishouDramaTaskConfig | null {
  if (!hasTaskConfig(options.config)) {
    return null;
  }

  const result = kuaishouDramaTaskSchema.safeParse(taskSource(options.config));
  if (result.success) {
    return result.data;
  }

  const details = result.error.issues
    .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
    .join("; ");
  throw new Error(`KUAISHOU_DRAMA_TASK_CONFIG_INVALID: ${details}`);
}

export function createMockKuaishouDramaTaskInput(
  overrides: Partial<KuaishouDramaTaskInput> = {},
): KuaishouDramaTaskInput {
  return {
    title: "示例漫剧标题",
    coverImageUrl: "https://picsum.photos/seed/kuaishou-cover/720/1280.jpg",
    summary:
      "这是一个用于调试快手短剧经营者平台自动填表的模拟简介，文本长度满足页面一百到四百字的限制。剧情围绕主角在逆境中成长展开，包含完整起承转合、关键冲突和结局方向，用于验证输入框、字数校验和表单提交前的数据结构是否稳定。",
    genderChannel: "女频",
    categories: ["脑洞", "甜宠", "逆袭"],
    plotTags: ["豪门赘婿", "破镜重圆"],
    authorizationPromotionFileUrl: "https://picsum.photos/seed/kuaishou-auth/801/601.jpg",
    copyrightDeclarationFileUrl: "https://picsum.photos/seed/kuaishou-copyright/802/602.jpg",
    posterImageUrl: "https://picsum.photos/seed/kuaishou-poster/720/1281.jpg",
    productionOrganization: "北京赢夏科技有限公司",
    ...overrides,
  };
}
