import path from "node:path";
import console from "node:console";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import {
  findAvailableLlamaServerPort,
  LlamaServer,
} from "../dist/index.mjs";
import { createOpenAiCompatibleClient } from "../../drama-ai/dist/index.mjs";

const modelArgument = process.argv.slice(2).find((argument) => argument !== "--");
if (!modelArgument) {
  console.error("Usage: pnpm runtime:smoke <path-to-model.gguf>");
  process.exit(1);
}

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const server = new LlamaServer({
  contextSize: 512,
  executablePath: path.join(packageRoot, "vendor", "win-x64", "llama-server.exe"),
  modelPath: path.resolve(modelArgument),
  port: await findAvailableLlamaServerPort(),
  startupTimeoutMs: 60_000,
});

try {
  await server.start();
  const connection = server.connection;
  const client = createOpenAiCompatibleClient({
    apiKey: connection.apiKey,
    baseURL: connection.openAiBaseURL,
    model: connection.model,
  });
  const result = await client.generateText({
    maxTokens: 8,
    prompt: "Say OK",
    temperature: 0,
  });
  console.log(`llama-server @drama/ai smoke test passed: ${JSON.stringify(result.text)}`);
} finally {
  await server.stop();
}
