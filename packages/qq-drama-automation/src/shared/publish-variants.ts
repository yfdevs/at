import type { ClaimedQqDramaTask } from "./types.js";

export type QqDramaPublishVariant = {
  kind: "primary" | "secondary";
  title: string;
};

export function createQqDramaPublishVariants(
  task: ClaimedQqDramaTask,
): QqDramaPublishVariant[] {
  const variants: QqDramaPublishVariant[] = [{
    kind: "primary",
    title: task.playlet.title,
  }];
  if (task.playlet.secondVersionEnabled) {
    variants.push({
      kind: "secondary",
      title: task.playlet.secondVersionTitle!,
    });
  }
  return variants;
}
