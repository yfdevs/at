import assert from "node:assert/strict";
import test from "node:test";
import type { APIResponse, BrowserContext } from "playwright";

import { findUploadedQqDramaByExactTitle } from "../../src/automation/drama-list.js";

function response(payload: unknown): APIResponse {
  return {
    ok: () => true,
    status: () => 200,
    json: async () => payload,
  } as APIResponse;
}

function contextWithPages(
  pages: unknown[],
  requests: Array<{ data?: unknown; headers?: Record<string, string> }>,
) {
  let index = 0;
  return {
    cookies: async () => [{ name: "csrf_token", value: "runtime-token" }],
    request: {
      post: async (_url: string, options?: { data?: unknown; headers?: Record<string, string> }) => {
        requests.push(options ?? {});
        return response(pages[index++]);
      },
    },
  } as unknown as BrowserContext;
}

test("finds only an exact uploaded QQ drama title from fuzzy search results", async () => {
  const requests: Array<{ data?: unknown; headers?: Record<string, string> }> = [];
  const context = contextWithPages([{
    dramas: [
      { drama_id: "1", title: "我是夜市战神前传" },
      { drama_id: "2", title: "我是夜市战神", uploaded_episode_count: 45 },
    ],
    total: 2,
  }], requests);

  const drama = await findUploadedQqDramaByExactTitle(context, "我是夜市战神");
  assert.equal(drama?.drama_id, "2");
  assert.deepEqual(requests[0]?.data, {
    page: 1,
    page_size: 6,
    keyword: "我是夜市战神",
  });
  assert.equal(requests[0]?.headers?.["x-csrf-token"], "runtime-token");
});

test("checks later QQ result pages before deciding a title is missing", async () => {
  const requests: Array<{ data?: unknown; headers?: Record<string, string> }> = [];
  const firstPage = Array.from({ length: 6 }, (_, index) => ({
    drama_id: String(index + 1),
    title: `相似标题${index + 1}`,
  }));
  const context = contextWithPages([
    { dramas: firstPage, total: 7 },
    { dramas: [{ drama_id: "7", title: "第二版剧名" }], total: 7 },
  ], requests);

  const drama = await findUploadedQqDramaByExactTitle(context, "第二版剧名");
  assert.equal(drama?.drama_id, "7");
  assert.equal((requests[1]?.data as { page?: number }).page, 2);
});

test("returns missing when fuzzy QQ results contain no exact title", async () => {
  const context = contextWithPages([{
    dramas: [{ drama_id: "1", title: "我是夜市战神前传" }],
    total: 1,
  }], []);
  assert.equal(
    await findUploadedQqDramaByExactTitle(context, "我是夜市战神"),
    undefined,
  );
});
