import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { DramaAiClient } from "@drama/ai";

import {
  collectTaobaoSynopsis,
  formatTaobaoHashtags,
  formatTaobaoVideoDescription,
  prepareTaobaoEpisodeMetadata,
  taobaoContentTags,
} from "../../src/shared/episode-metadata.js";

test("reads synopsis text and generates all episode summaries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taobao-metadata-"));
  const resourceDir = path.join(root, "逆风翻盘", "海报封面", "剧情资料");
  await mkdir(resourceDir, { recursive: true });
  await writeFile(path.join(resourceDir, "简介.txt"), "男主遭到背叛后寻找证据并完成反击。", "utf8");
  let saved: { dramaTag: string; episodeSummaries: string[] } | undefined;
  const client = {
    async generateText() {
      return {
        finishReason: "stop",
        model: "test-model",
        text: JSON.stringify({
          tag: "都市",
          episodes: [
            { episode: 1, summary: "男主意外发现骗局" },
            { episode: 2, summary: "搜集证据成功反击" },
          ],
        }),
      };
    },
  } as DramaAiClient;
  try {
    const synopsis = await collectTaobaoSynopsis(path.join(root, "逆风翻盘"));
    assert.match(synopsis.text ?? "", /男主遭到背叛/);
    const metadata = await prepareTaobaoEpisodeMetadata({
      id: "task-1",
      originalTitle: "逆风翻盘",
      baiduPanResourceLink: "https://pan.baidu.com/s/example?pwd=1234",
      episodeCount: 2,
    }, {
      localMaterialRoot: root,
      aiClientFactory: () => client,
      saveGeneratedMetadata: (_taskId, value) => { saved = value; },
    });
    assert.equal(metadata.dramaTag, "都市");
    assert.deepEqual(metadata.episodeSummaries, ["男主意外发现骗局", "搜集证据成功反击"]);
    assert.equal(saved?.dramaTag, "都市");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("formats Taobao description and hashtag text", () => {
  assert.equal(formatTaobaoVideoDescription(3, "第三集：女主揭开豪门秘密。"), "第3集|女主揭开豪门秘密");
  assert.deepEqual(taobaoContentTags("顺手牵羊的代价", "现代"), ["AI短剧", "现代"]);
  assert.equal(formatTaobaoHashtags("顺手牵羊的代价", "现代"), "#AI短剧 #现代");
});
