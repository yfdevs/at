import assert from "node:assert/strict";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  buildLlamaServerArguments,
  checkLlamaServerHealth,
  findAvailableLlamaServerPort,
  LlamaServer,
  LlamaServerError,
} from "../src/index.js";

const fixturesDirectory = fileURLToPath(new URL("fixtures", import.meta.url));
const fixtureServerPath = path.join(fixturesDirectory, "fake-llama-server.mjs");
const fixtureModelPath = path.join(fixturesDirectory, "fake-model.gguf");

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a test port."));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

test("buildLlamaServerArguments builds managed llama.cpp arguments", () => {
  assert.deepEqual(buildLlamaServerArguments({
    apiKey: "local-secret",
    contextSize: 4096,
    executablePath: "llama-server.exe",
    gpuLayers: 99,
    host: "127.0.0.1",
    modelAlias: "local-model",
    modelPath: "model.gguf",
    port: 8123,
    threads: 4,
  }), [
    "--model", "model.gguf",
    "--host", "127.0.0.1",
    "--port", "8123",
    "--alias", "local-model",
    "--ctx-size", "4096",
    "--n-gpu-layers", "99",
    "--threads", "4",
    "--api-key", "local-secret",
  ]);
});

test("managed arguments cannot be overridden", () => {
  assert.throws(
    () => buildLlamaServerArguments({
      additionalArguments: ["--port=9000"],
      executablePath: "llama-server.exe",
      modelPath: "model.gguf",
    }),
    (error) => error instanceof LlamaServerError && error.code === "LLAMA_SERVER_INVALID_OPTION",
  );
});

test("model filename becomes the default OpenAI model alias", () => {
  const arguments_ = buildLlamaServerArguments({
    executablePath: "llama-server.exe",
    modelPath: path.join("models", "Qwen3-4B-Q4_K_M.gguf"),
  });

  assert.deepEqual(arguments_.slice(-2), ["--alias", "Qwen3-4B-Q4_K_M"]);
});

test("health check does not accept an unrelated HTTP 200 response", async () => {
  const health = await checkLlamaServerHealth(
    "http://127.0.0.1:8080",
    100,
    async () => new Response("healthy", { status: 200 }),
  );

  assert.deepEqual(health, { status: "loading", statusCode: 200, detail: "healthy" });
});

test("findAvailableLlamaServerPort skips a port that is already in use", async () => {
  const occupiedPort = await availablePort();
  const blocker = net.createServer();
  await new Promise<void>((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(occupiedPort, "127.0.0.1", resolve);
  });
  try {
    assert.equal(
      await findAvailableLlamaServerPort(occupiedPort, occupiedPort + 1),
      occupiedPort + 1,
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      blocker.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("LlamaServer starts, reports a reusable connection, and stops", async (context) => {
  const port = await availablePort();
  const logs: string[] = [];
  const server = new LlamaServer({
    additionalArguments: ["--fake-ready-delay", "50"],
    executablePath: process.execPath,
    launcherArguments: [fixtureServerPath],
    modelAlias: "fixture-model",
    modelPath: fixtureModelPath,
    onLog: ({ message }) => logs.push(message),
    port,
    startupTimeoutMs: 5_000,
  });
  context.after(() => server.stop());

  await server.start();

  assert.equal(server.state, "running");
  assert.ok(server.pid);
  assert.deepEqual(server.connection, {
    apiKey: "sk-no-key-required",
    baseURL: `http://127.0.0.1:${port}`,
    model: "fixture-model",
    openAiBaseURL: `http://127.0.0.1:${port}/v1`,
  });
  assert.equal((await checkLlamaServerHealth(server.baseURL)).status, "ready");
  assert.match(logs.join(""), /fake llama-server listening/);

  await server.stop();
  assert.equal(server.state, "stopped");
  assert.equal((await checkLlamaServerHealth(server.baseURL, 100)).status, "unreachable");
});

test("LlamaServer rejects missing executable and model paths with a stable code", async () => {
  const server = new LlamaServer({
    executablePath: path.join(fixturesDirectory, "missing-llama-server.exe"),
    modelPath: fixtureModelPath,
  });

  await assert.rejects(
    () => server.start(),
    (error) => error instanceof LlamaServerError && error.code === "LLAMA_SERVER_EXECUTABLE_NOT_FOUND",
  );
  assert.equal(server.state, "failed");
});
