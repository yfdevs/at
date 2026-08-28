import {
  createOpenAiCompatibleClient,
  type OpenAiCompatibleClient,
  type OpenAiCompatibleClientOptions,
} from "@drama/ai";
import { ipcMain, safeStorage, shell } from "electron";
import Store from "electron-store";
import sharp from "sharp";

const ARK_API_KEY_URL = "https://console.volcengine.com/ark/region:ark+cn-beijing/apikey";
const LEGACY_DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
const RECOMMENDED_AI_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const RECOMMENDED_AI_MODEL = "doubao-seed-2-0-pro-260215";
const RECOMMENDED_AI_IMAGE_MODEL = "doubao-seedream-4-0-250828";

export type GlobalAppConfig = {
  aiApiKey: string;
  aiBaseURL: string;
  aiModel: string;
  aiImageModel: string;
};

type StoredGlobalAppConfig = {
  aiApiKeyCiphertext: string;
  aiBaseURL: string;
  aiModel: string;
  aiImageModel: string;
};

type GlobalAppConfigStore = {
  config: StoredGlobalAppConfig;
};

const defaultStoredConfig: StoredGlobalAppConfig = {
  aiApiKeyCiphertext: "",
  aiBaseURL: RECOMMENDED_AI_BASE_URL,
  aiModel: RECOMMENDED_AI_MODEL,
  aiImageModel: RECOMMENDED_AI_IMAGE_MODEL,
};

let registered = false;
let store: Store<GlobalAppConfigStore> | null = null;

function getStore() {
  store ??= new Store<GlobalAppConfigStore>({
    name: "global-app-config",
    defaults: { config: defaultStoredConfig },
  });
  return store;
}

function normalizeBaseURL(value: string | undefined) {
  const normalized = value?.trim() || RECOMMENDED_AI_BASE_URL;

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("AI_BASE_URL_INVALID");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("AI_BASE_URL_INVALID");
  }

  return normalized.replace(/\/+$/, "");
}

function encryptApiKey(apiKey: string) {
  if (!apiKey) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("APP_CONFIG_ENCRYPTION_UNAVAILABLE");
  }

  return safeStorage.encryptString(apiKey).toString("base64");
}

function decryptApiKey(ciphertext: string) {
  if (!ciphertext) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("APP_CONFIG_ENCRYPTION_UNAVAILABLE");
  }

  try {
    return safeStorage.decryptString(Buffer.from(ciphertext, "base64"));
  } catch {
    throw new Error("APP_CONFIG_API_KEY_DECRYPT_FAILED");
  }
}

function normalizeGlobalAppConfig(config: Partial<GlobalAppConfig>): GlobalAppConfig {
  return {
    aiApiKey: config.aiApiKey?.trim() ?? "",
    aiBaseURL: normalizeBaseURL(config.aiBaseURL),
    aiModel: config.aiModel?.trim() ?? "",
    aiImageModel: config.aiImageModel?.trim() || RECOMMENDED_AI_IMAGE_MODEL,
  };
}

export function readGlobalAppConfig(): GlobalAppConfig {
  let config = getStore().get("config");
  if (
    !config.aiApiKeyCiphertext
    && !config.aiModel.trim()
    && config.aiBaseURL === LEGACY_DEFAULT_AI_BASE_URL
  ) {
    config = defaultStoredConfig;
    getStore().set("config", config);
  }

  return {
    aiApiKey: decryptApiKey(config.aiApiKeyCiphertext),
    aiBaseURL: normalizeBaseURL(config.aiBaseURL),
    aiModel: config.aiModel.trim(),
    aiImageModel: config.aiImageModel?.trim() || RECOMMENDED_AI_IMAGE_MODEL,
  };
}

function saveGlobalAppConfig(config: Partial<GlobalAppConfig>) {
  const normalized = normalizeGlobalAppConfig(config);

  getStore().set("config", {
    aiApiKeyCiphertext: encryptApiKey(normalized.aiApiKey),
    aiBaseURL: normalized.aiBaseURL,
    aiModel: normalized.aiModel,
    aiImageModel: normalized.aiImageModel,
  });

  return normalized;
}

function configResult(config = readGlobalAppConfig()) {
  return {
    config,
    path: getStore().path,
    restartRequired: false,
  };
}

function aiClientOptions(config: GlobalAppConfig): OpenAiCompatibleClientOptions {
  if (!config.aiApiKey) throw new Error("DRAMA_AI_API_KEY_REQUIRED");
  if (!config.aiModel) throw new Error("DRAMA_AI_MODEL_REQUIRED");

  return {
    apiKey: config.aiApiKey,
    baseURL: config.aiBaseURL,
    model: config.aiModel,
  };
}

export function getConfiguredAiClientOptions(): OpenAiCompatibleClientOptions {
  return aiClientOptions(readGlobalAppConfig());
}

export function createConfiguredAiClient(): OpenAiCompatibleClient {
  return createOpenAiCompatibleClient(getConfiguredAiClientOptions());
}

export function getConfiguredAiImageModel() {
  const model = readGlobalAppConfig().aiImageModel.trim();
  if (!model) throw new Error("DRAMA_AI_IMAGE_MODEL_REQUIRED");
  return model;
}

async function testAiConfig(config: Partial<GlobalAppConfig>) {
  const client = createOpenAiCompatibleClient(aiClientOptions(normalizeGlobalAppConfig(config)));
  const testImage = await sharp({
    create: {
      background: { alpha: 1, b: 70, g: 35, r: 220 },
      channels: 4,
      height: 64,
      width: 64,
    },
  }).png().toBuffer();
  const startedAt = Date.now();
  const result = await client.analyzeImages({
    images: [{ dataUrl: `data:image/png;base64,${testImage.toString("base64")}`, type: "data-url" }],
    maxTokens: 16,
    prompt: "这是图片与文本能力连接测试。确认能读取图片后，只回复 OK。",
  });

  return {
    latencyMs: Date.now() - startedAt,
    model: result.model,
    responseText: result.text.replace(/\s+/g, " ").slice(0, 80),
  };
}

export function registerGlobalAppConfigHandlers() {
  if (registered) return;
  registered = true;

  ipcMain.handle("app:config:get", () => configResult());
  ipcMain.handle("app:config:save", (_event, config: Partial<GlobalAppConfig>) => {
    return configResult(saveGlobalAppConfig(config));
  });
  ipcMain.handle("app:config:test", (_event, config: Partial<GlobalAppConfig>) => {
    return testAiConfig(config);
  });
  ipcMain.handle("app:config:open-ark-api-key-page", () => shell.openExternal(ARK_API_KEY_URL));
}
