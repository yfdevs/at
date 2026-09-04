import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type {
  DramaAiClient,
  ImageAnalysisOptions,
  ImageGenerationOptions,
} from "@drama/ai";
import {
  readImageDimensions,
  type LocalPosterImageFile,
} from "@drama/drama-media-assets";

import {
  buildKuaishouCounterpartCoverPrompt,
  KUAISHOU_DRAMA_COVER_SIZE,
  KUAISHOU_EPISODE_COVER_SIZE,
  prepareKuaishouDramaCoverFiles,
  resolveKuaishouDramaCoverFile,
  resolveKuaishouEpisodeCoverFile,
  selectKuaishouCoverSources,
} from "../../src/shared/cover-materials.js";
import type { KuaishouDramaTaskConfig } from "../../src/shared/types.js";

function poster(
  file: string,
  width: number,
  height: number,
): LocalPosterImageFile {
  return {
    name: path.basename(file),
    file,
    size: 1,
    width,
    height,
  };
}

function svg(width: number, height: number, color: string) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect width="100%" height="100%" fill="${color}"/>` +
      `<circle cx="50%" cy="45%" r="20%" fill="#ffffff"/>` +
      `</svg>`,
  );
}

void test("selects existing landscape and portrait sources independently", () => {
  const sources = selectKuaishouCoverSources([
    poster("portrait.jpg", 900, 1_200),
    poster("landscape.jpg", 1_600, 1_000),
  ]);

  assert.equal(sources.landscape?.file, "landscape.jpg");
  assert.equal(sources.portrait?.file, "portrait.jpg");
  assert.equal(sources.fallback?.file, "portrait.jpg");
});

void test("keeps technical dimensions out of model-visible generation prompts", () => {
  const dramaPrompt = buildKuaishouCounterpartCoverPrompt({
    kind: "drama",
    title: "测试短剧",
  });
  const episodePrompt = buildKuaishouCounterpartCoverPrompt({
    kind: "episode",
    title: "测试短剧",
  });

  assert.match(dramaPrompt, /横版/);
  assert.match(episodePrompt, /竖版/);
  assert.match(dramaPrompt, /“测试短剧”/);
  assert.doesNotMatch(dramaPrompt, /414:258|2208x1376/);
  assert.doesNotMatch(episodePrompt, /224:300|1792x2400/);
  assert.match(dramaPrompt, /演员姓名、演员表、职员表/);
  assert.match(dramaPrompt, /画幅比例、分辨率/);
  assert.match(dramaPrompt, /参考图若含剧名以外的文字，必须删除/);
});

void test("generates only the missing landscape cover and shares prepared files across variants", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "kuaishou-cover-test-"));
  try {
    const portraitFile = path.join(temporaryRoot, "portrait.svg");
    await writeFile(portraitFile, svg(900, 1_200, "#1d4ed8"));
    const requests: ImageGenerationOptions[] = [];
    const aiClient = {
      generateImage: async (request: ImageGenerationOptions) => {
        requests.push(request);
        return {
          images: [{
            data: svg(
              KUAISHOU_DRAMA_COVER_SIZE.width,
              KUAISHOU_DRAMA_COVER_SIZE.height,
              "#b91c1c",
            ),
            mimeType: "image/svg+xml",
          }],
          model: request.model ?? "test-image-model",
        };
      },
      analyzeImages: async (_request: ImageAnalysisOptions) => ({
        finishReason: "stop",
        model: "test-analysis-model",
        text: JSON.stringify({
          mainSubjectsComplete: true,
          facesIntact: true,
          titleTextExact: true,
          titleInsideSafeArea: true,
          unrelatedTextFree: true,
          noWatermarkOrTechnicalOverlay: true,
          noMirroringOrTiling: true,
          referenceSimilarityConfidence: 0.98,
          detectedTitleText: "竖版补横版测试剧",
          issues: [],
        }),
      }),
    } as unknown as DramaAiClient;
    const task = {
      title: "竖版补横版测试剧",
    } as unknown as KuaishouDramaTaskConfig;

    const result = await prepareKuaishouDramaCoverFiles(
      task,
      [poster(portraitFile, 900, 1_200)],
      {
        aiClient,
        aiImageModel: "test-image-model",
        assetDownloadDir: temporaryRoot,
      },
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.size, "2208x1376");
    assert.deepEqual(
      await readImageDimensions(result.dramaCover),
      KUAISHOU_DRAMA_COVER_SIZE,
    );
    assert.deepEqual(
      await readImageDimensions(result.episodeCover),
      KUAISHOU_EPISODE_COVER_SIZE,
    );
    assert.equal(resolveKuaishouDramaCoverFile(task), result.dramaCover);
    assert.equal(resolveKuaishouEpisodeCoverFile(task), result.episodeCover);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

void test("does not call AI when both source orientations already exist", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "kuaishou-cover-existing-test-"));
  try {
    const landscapeFile = path.join(temporaryRoot, "landscape.svg");
    const portraitFile = path.join(temporaryRoot, "portrait.svg");
    await Promise.all([
      writeFile(landscapeFile, svg(1_600, 1_000, "#b91c1c")),
      writeFile(portraitFile, svg(900, 1_200, "#1d4ed8")),
    ]);
    const task = { title: "双封面测试剧" } as unknown as KuaishouDramaTaskConfig;

    const result = await prepareKuaishouDramaCoverFiles(
      task,
      [
        poster(portraitFile, 900, 1_200),
        poster(landscapeFile, 1_600, 1_000),
      ],
      { assetDownloadDir: temporaryRoot },
    );

    assert.deepEqual(await readImageDimensions(result.dramaCover), KUAISHOU_DRAMA_COVER_SIZE);
    assert.deepEqual(await readImageDimensions(result.episodeCover), KUAISHOU_EPISODE_COVER_SIZE);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
