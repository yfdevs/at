// oxlint-disable typescript/no-floating-promises
import type { DramaAiClient, TextGenerationOptions } from "@drama/ai";
import assert from "node:assert/strict";
import test from "node:test";

import { createMockIqiyiDramaTask } from "../api/task.js";
import { resolveIqiyiRecommendation, validIqiyiRecommendation } from "./recommendation.js";

function fakeTextClient(outputs: string[]) {
  const requests: TextGenerationOptions[] = [];
  const client = {
    analyzeImages: async () => {
      throw new Error("not implemented");
    },
    generateImage: async () => {
      throw new Error("not implemented");
    },
    generateText: async (options: TextGenerationOptions) => {
      requests.push(options);
      return {
        finishReason: "stop",
        model: "test-text-model",
        text: outputs.shift() ?? "",
      };
    },
  } satisfies DramaAiClient;
  return { client, requests };
}

test("reuses the title when it is already between 4 and 10 characters", async () => {
  const task = createMockIqiyiDramaTask();
  task.playlet.title = "海上奇缘";
  const fake = fakeTextClient([]);

  assert.equal(await resolveIqiyiRecommendation(task.playlet, { aiClient: fake.client }), "海上奇缘");
  assert.equal(fake.requests.length, 0);
});

test("uses AI and retries until a long title has a valid recommendation", async () => {
  const task = createMockIqiyiDramaTask();
  const fake = fakeTextClient(["太短", "一句话推荐：深海奇缘再续"]);

  const recommendation = await resolveIqiyiRecommendation(task.playlet, { aiClient: fake.client });
  assert.equal(recommendation, "深海奇缘再续");
  assert.equal(fake.requests.length, 2);
  assert.equal(validIqiyiRecommendation(recommendation), true);
  assert.match(fake.requests[0]?.prompt ?? "", /严格为 4 至 10 个中文汉字/u);
});

test("requires the global AI client when the title is outside the range", async () => {
  const task = createMockIqiyiDramaTask();
  await assert.rejects(
    resolveIqiyiRecommendation(task.playlet, {}),
    /DRAMA_AI_API_KEY_REQUIRED/u,
  );
});
