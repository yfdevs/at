import {
  createOpenAiCompatibleClient,
  type OpenAiCompatibleClient,
} from "@drama/ai";
import {
  assertBundledLlamaServerRuntime,
  findAvailableLlamaServerPort,
  LlamaServer,
} from "@drama/llama-server";
import { app } from "electron";
import path from "node:path";
import { logMain } from "./main-logger";

export type LocalAiRuntimeConfig = {
  contextSize: number;
  modelPath: string;
  multimodalProjectorPath?: string;
  threads?: number;
};

type ActiveLocalAiRuntime = {
  client: OpenAiCompatibleClient;
  configKey: string;
  server: LlamaServer;
};

let activeRuntime: ActiveLocalAiRuntime | null = null;
let startingRuntime: { configKey: string; promise: Promise<ActiveLocalAiRuntime> } | null = null;

function appRoot(): string {
  return process.env.APP_ROOT || path.resolve(process.cwd());
}

function runtimeConfigKey(config: LocalAiRuntimeConfig): string {
  return JSON.stringify({
    contextSize: config.contextSize,
    modelPath: path.resolve(config.modelPath),
    multimodalProjectorPath: config.multimodalProjectorPath
      ? path.resolve(config.multimodalProjectorPath)
      : "",
    threads: config.threads,
  });
}

function runtimeLogger() {
  return {
    debug: (message: string, fields?: Record<string, unknown>) => {
      logMain("debug", message, fields, "local-ai");
    },
    info: (message: string, fields?: Record<string, unknown>) => {
      logMain("info", message, fields, "local-ai");
    },
    warn: (message: string, fields?: Record<string, unknown>) => {
      logMain("warn", message, fields, "local-ai");
    },
    error: (message: string, fields?: Record<string, unknown>) => {
      logMain("error", message, fields, "local-ai");
    },
  };
}

async function startRuntime(
  config: LocalAiRuntimeConfig,
  configKey: string,
): Promise<ActiveLocalAiRuntime> {
  if (!config.modelPath.trim()) throw new Error("LOCAL_AI_MODEL_PATH_REQUIRED");

  const executablePath = await assertBundledLlamaServerRuntime({
    appRoot: appRoot(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  });
  const port = await findAvailableLlamaServerPort();
  const server = new LlamaServer({
    apiKey: "autodrama-local",
    contextSize: config.contextSize,
    executablePath,
    modelPath: config.modelPath,
    multimodalProjectorPath: config.multimodalProjectorPath,
    port,
    startupTimeoutMs: 5 * 60_000,
    threads: config.threads,
    logger: runtimeLogger(),
  });

  try {
    await server.start();
    const connection = server.connection;
    return {
      client: createOpenAiCompatibleClient({
        apiKey: connection.apiKey,
        baseURL: connection.openAiBaseURL,
        model: connection.model,
        timeoutMs: 5 * 60_000,
      }),
      configKey,
      server,
    };
  } catch (error) {
    await server.stop().catch(() => undefined);
    throw error;
  }
}

export async function ensureLocalAiClient(
  config: LocalAiRuntimeConfig,
): Promise<OpenAiCompatibleClient> {
  const configKey = runtimeConfigKey(config);
  if (activeRuntime?.configKey === configKey && activeRuntime.server.state === "running") {
    return activeRuntime.client;
  }
  if (startingRuntime?.configKey === configKey) {
    return (await startingRuntime.promise).client;
  }

  if (startingRuntime) await startingRuntime.promise.catch(() => undefined);
  if (activeRuntime) {
    await activeRuntime.server.stop();
    activeRuntime = null;
  }

  const promise = startRuntime(config, configKey);
  startingRuntime = { configKey, promise };
  try {
    activeRuntime = await promise;
    return activeRuntime.client;
  } finally {
    if (startingRuntime?.promise === promise) startingRuntime = null;
  }
}

export async function stopLocalAiRuntime(): Promise<void> {
  if (startingRuntime) await startingRuntime.promise.catch(() => undefined);
  const runtime = activeRuntime;
  activeRuntime = null;
  if (runtime) await runtime.server.stop();
}

export function getLocalAiRuntimeStatus() {
  return {
    pid: activeRuntime?.server.pid,
    state: startingRuntime ? "starting" : activeRuntime?.server.state ?? "stopped",
  };
}
