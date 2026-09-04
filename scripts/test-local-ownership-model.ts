import { createOpenAiCompatibleClient } from "@drama/ai";
import { classifyOwnershipProjectProofWithAi } from "@drama/drama-media-assets";
import { findAvailableLlamaServerPort, LlamaServer } from "@drama/llama-server";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

type OwnershipKind = "jianying" | "juchuang";

const defaultDirectory = "D:\\BaiduNetdiskDownload\\装够了，本宫天下无敌\\权属文件";
const defaultRuntime = path.resolve("packages", "llama-server", "vendor", "win-x64", "llama-server.exe");

const { values } = parseArgs({
  options: {
    context: { default: "4096", type: "string" },
    directory: { default: defaultDirectory, type: "string" },
    kind: { default: "all", type: "string" },
    mmproj: { type: "string" },
    model: { type: "string" },
    runtime: { default: defaultRuntime, type: "string" },
    threads: { type: "string" },
  },
  strict: true,
});

function requiredPath(value: string | undefined, option: string): string {
  const resolved = value?.trim() ? path.resolve(value) : "";
  if (!resolved) throw new Error(`缺少 ${option} 参数。`);
  if (!existsSync(resolved)) throw new Error(`${option} 文件不存在：${resolved}`);
  return resolved;
}

function positiveInteger(value: string | undefined, option: string): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${option} 必须是正整数。`);
  return parsed;
}

function expectedKind(filename: string): OwnershipKind | undefined {
  if (/^剪映\d+\.(?:png|jpe?g|webp)$/iu.test(filename)) return "jianying";
  if (/^剧创\d+\.(?:png|jpe?g|webp)$/iu.test(filename)) return "juchuang";
  return undefined;
}

async function main() {
  const modelPath = requiredPath(values.model, "--model");
  const mmprojPath = requiredPath(values.mmproj, "--mmproj");
  const runtimePath = requiredPath(values.runtime, "--runtime");
  const directory = path.resolve(values.directory);
  if (!existsSync(directory)) throw new Error(`测试图片目录不存在：${directory}`);

  const contextSize = positiveInteger(values.context, "--context") ?? 4096;
  const threads = positiveInteger(values.threads, "--threads");
  const requestedKind = values.kind;
  if (requestedKind !== "all" && requestedKind !== "jianying" && requestedKind !== "juchuang") {
    throw new Error("--kind 只能是 all、jianying 或 juchuang。");
  }
  const filenames = (await readdir(directory))
    .map((filename) => ({ expected: expectedKind(filename), filename }))
    .filter((item): item is { expected: OwnershipKind; filename: string } => Boolean(item.expected))
    .filter((item) => requestedKind === "all" || item.expected === requestedKind)
    .sort((left, right) => left.filename.localeCompare(right.filename, "zh-CN", { numeric: true }));
  if (filenames.length === 0) throw new Error(`目录中没有找到“剪映N/剧创N”测试图片：${directory}`);

  const port = await findAvailableLlamaServerPort();
  const server = new LlamaServer({
    apiKey: "ownership-model-test",
    contextSize,
    executablePath: runtimePath,
    modelPath,
    multimodalProjectorPath: mmprojPath,
    port,
    startupTimeoutMs: 5 * 60_000,
    threads,
  });

  try {
    console.log(`正在加载模型：${path.basename(modelPath)}`);
    await server.start();
    const client = createOpenAiCompatibleClient({
      apiKey: server.connection.apiKey,
      baseURL: server.connection.openAiBaseURL,
      model: server.connection.model,
      timeoutMs: 5 * 60_000,
    });
    let correct = 0;
    const startedAt = Date.now();
    for (const item of filenames) {
      const imageStartedAt = Date.now();
      const actual = await classifyOwnershipProjectProofWithAi(
        path.join(directory, item.filename),
        client,
      );
      const passed = actual === item.expected;
      if (passed) correct += 1;
      console.log(
        `${passed ? "✓" : "✗"} ${item.filename} 期望=${item.expected} 实际=${actual} `
          + `耗时=${((Date.now() - imageStartedAt) / 1000).toFixed(1)}s`,
      );
    }

    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`\n结果：${correct}/${filenames.length} 正确，准确率=${(correct / filenames.length * 100).toFixed(1)}%，总耗时=${elapsedSeconds}s`);
    if (correct !== filenames.length) process.exitCode = 1;
  } finally {
    await server.stop().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
