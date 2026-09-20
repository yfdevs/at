import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMockDouyinNetdiskTestTask } from "../../src/api/mock-task.js";
import {
  collectDouyinNetdiskMetadataInputs,
  enrichDouyinTaskFromNetdisk,
} from "../../src/shared/netdisk-metadata.js";
import type { DouyinDramaAiClient } from "../../src/shared/types.js";

function fakeAiClient(responseText: string, onGenerate: () => void): DouyinDramaAiClient {
  return {
    async generateText() {
      onGenerate();
      return { finishReason: "stop", model: "fake-text-model", text: responseText };
    },
  };
}

test("uses one AI text call to produce synopsis, roles, and filename-matched avatars", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "douyin-netdisk-metadata-"));
  const task = createMockDouyinNetdiskTestTask();
  const resourceDir = path.join(root, task.originalTitle);
  const originalImageDir = path.join(resourceDir, "海报封面", "原始图片");
  const textDir = path.join(resourceDir, "海报封面", "剧情资料");
  await mkdir(originalImageDir, { recursive: true });
  await mkdir(textDir, { recursive: true });
  await writeFile(path.join(originalImageDir, "男主：刘晓-角色头像.png"), "fake-image");
  await writeFile(path.join(originalImageDir, "货主.jpeg"), "fake-image");
  await writeFile(
    path.join(textDir, "剧情及角色介绍.txt"),
    "刘晓是一名货车司机，长期被货主当作免费运输工具，最终决定收回车辆。货主是主要矛盾推动者。",
  );
  const summary = (
    "刘晓经营货车运输，却长期被人以人情为由当成免费的拉货工具。面对货主一次次得寸进尺，他终于选择收回车辆，拒绝继续无偿付出，并在冲突中守住自己的劳动成果与生活边界。"
      + "故事围绕他的觉醒与反抗展开，呈现普通劳动者维护尊严、重新掌握人生方向的过程。"
  ).slice(0, 190);
  let calls = 0;
  const response = JSON.stringify({
    summary,
    roles: [
      {
        name: "刘晓",
        roleType: "主角",
        intro: "货车司机，从一味忍让转向维护自身权益。",
        photoImageId: "image-1",
      },
      {
        name: "货主",
        roleType: "配角",
        intro: "不断提出无偿运输要求，是剧情矛盾的主要推动者。",
        // Exercise the deterministic filename fallback when the AI omits an id.
        photoImageId: null,
      },
      {
        name: "路人",
        roleType: "参演",
        intro: "围观冲突的路人。",
        photoImageId: null,
      },
    ],
  });

  try {
    const enriched = await enrichDouyinTaskFromNetdisk(task, {
      localEpisodeVideoRoot: root,
      aiClientFactory: () => fakeAiClient(response, () => { calls += 1; }),
    });
    assert.equal(calls, 1);
    assert.equal(enriched.playlet.summary, summary);
    assert.equal(enriched.playlet.roles.length, 2);
    assert.equal(enriched.playlet.roles[0]?.roleType, "主角");
    assert.equal(
      enriched.playlet.roles[0]?.photoFile,
      path.join(originalImageDir, "男主：刘晓-角色头像.png"),
    );
    assert.equal(enriched.playlet.roles[1]?.photoFile, path.join(originalImageDir, "货主.jpeg"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails before form automation when fewer than two netdisk role images can be matched", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "douyin-netdisk-role-images-"));
  const task = createMockDouyinNetdiskTestTask();
  const resourceDir = path.join(root, task.originalTitle);
  const originalImageDir = path.join(resourceDir, "海报封面", "原始图片");
  const textDir = path.join(resourceDir, "海报封面", "剧情资料");
  await mkdir(originalImageDir, { recursive: true });
  await mkdir(textDir, { recursive: true });
  await writeFile(path.join(originalImageDir, "刘晓.png"), "fake-image");
  await writeFile(path.join(textDir, "简介.txt"), "刘晓是货车司机，货主长期要求他免费拉货。", "utf8");
  const response = JSON.stringify({
    summary: "刘晓经营货车运输，却长期被人以人情为由当成免费的拉货工具。面对货主一次次得寸进尺，他终于选择收回车辆，拒绝继续无偿付出，并在冲突中守住自己的劳动成果与生活边界。故事围绕他的觉醒与反抗展开，呈现普通劳动者维护尊严并重新掌握人生方向的过程。",
    roles: [
      { name: "刘晓", roleType: "主角", intro: "货车司机。", photoImageId: "image-1" },
      { name: "货主", roleType: "配角", intro: "矛盾推动者。", photoImageId: null },
    ],
  });

  try {
    await assert.rejects(
      enrichDouyinTaskFromNetdisk(task, {
        localEpisodeVideoRoot: root,
        aiClientFactory: () => fakeAiClient(response, () => undefined),
      }),
      /DOUYIN_DRAMA_ROLE_PHOTO_REQUIRED.*实际=1/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requires a netdisk text file when the backend synopsis is absent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "douyin-netdisk-no-text-"));
  const task = createMockDouyinNetdiskTestTask();
  await mkdir(path.join(root, task.originalTitle), { recursive: true });
  let calls = 0;
  try {
    await assert.rejects(
      enrichDouyinTaskFromNetdisk(task, {
        localEpisodeVideoRoot: root,
        aiClientFactory: () => fakeAiClient("{}", () => { calls += 1; }),
      }),
      /DOUYIN_DRAMA_NETDISK_TEXT_REQUIRED/,
    );
    assert.equal(calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("collects preserved original image names and TXT content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "douyin-netdisk-collect-"));
  const image = path.join(root, "海报封面", "原始图片", "女主-小雨.jpg");
  const text = path.join(root, "海报封面", "剧情资料", "简介.txt");
  await mkdir(path.dirname(image), { recursive: true });
  await mkdir(path.dirname(text), { recursive: true });
  await writeFile(image, "image");
  await writeFile(text, "这是剧情简介和角色说明。", "utf8");
  try {
    const inputs = await collectDouyinNetdiskMetadataInputs(root);
    assert.equal(inputs.images[0]?.fileName, "女主-小雨.jpg");
    assert.equal(inputs.texts[0]?.content, "这是剧情简介和角色说明。");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
