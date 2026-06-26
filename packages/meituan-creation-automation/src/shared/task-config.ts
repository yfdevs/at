import type {
  MeituanCreationConfig,
  MeituanCreationRuntimeOptions,
  MeituanCreationTaskConfig,
} from "./types.js";
import { meituanCreationTaskSchema } from "./types.js";

function hasTaskConfig(config: MeituanCreationConfig | undefined) {
  return Boolean(
    config?.authorNicknameText ||
    config?.audience ||
    config?.collectionType ||
    config?.collectionSubType ||
    config?.collectionTitle ||
    config?.collectionCoverUrl ||
    config?.copyrightProofUrl ||
    config?.premiereProofUrl ||
    config?.backgroundText ||
    config?.plotSettingTexts ||
    config?.storyThemeText ||
    config?.totalEpisodes ||
    config?.checkpointEpisodes ||
    config?.productionCompanyText ||
    config?.directorNames ||
    config?.producerNames ||
    config?.screenwriterNames ||
    config?.actorNames ||
    config?.averageEpisodeDurationMinutes ||
    config?.plotSynopsisText ||
    config?.premiereStatus ||
    config?.expectedPremiereTimeText,
  );
}

export function parseTaskConfig(options: MeituanCreationRuntimeOptions): MeituanCreationTaskConfig | null {
  if (!hasTaskConfig(options.config)) {
    return null;
  }

  const result = meituanCreationTaskSchema.safeParse(options.config);

  if (result.success) {
    return result.data;
  }

  const details = result.error.issues
    .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
    .join("; ");
  throw new Error(`MEITUAN_TASK_CONFIG_INVALID: ${details}`);
}
