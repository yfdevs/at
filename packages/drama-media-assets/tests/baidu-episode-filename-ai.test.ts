import assert from "node:assert/strict";
import test from "node:test";
import type { DramaAiClient, TextGenerationOptions } from "@drama/ai";

import { selectBaiduEpisodePathsWithAi } from "../src/index.js";

test("sends every candidate filename to AI and maps selected IDs back to paths", async () => {
  let prompt = "";
  const client = {
    generateText: async (options: TextGenerationOptions) => {
      prompt = options.prompt;
      return {
        finishReason: "stop",
        model: "test",
        text: '{"selectedIds":[2,4],"reason":"统一的正片命名"}',
      };
    },
  } as DramaAiClient;
  const candidates = [
    { id: 1, index: 1, name: "分集-1.mp4", path: "/分集-1.mp4", size: 100 },
    { id: 2, index: 1, name: "剧名-第1集.mp4", path: "/剧名-第1集.mp4", size: 100 },
    { id: 3, index: 2, name: "分集-2.mp4", path: "/分集-2.mp4", size: 200 },
    { id: 4, index: 2, name: "剧名-第2集.mp4", path: "/剧名-第2集.mp4", size: 200 },
  ];

  assert.deepEqual(await selectBaiduEpisodePathsWithAi({
    client,
    resourceName: "剧名",
    expectedEpisodeCount: 2,
    candidates,
  }), ["/剧名-第1集.mp4", "/剧名-第2集.mp4"]);
  assert.ok(candidates.every((candidate) => prompt.includes(candidate.name)));
});
