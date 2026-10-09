export type JianyingConfig = {
  executablePath: string;
};

export type JianyingConfigResult = {
  config: JianyingConfig;
  path: string;
};

export type JianyingStatus = {
  platform: "jianying";
  isWindows: boolean;
  appRunning: boolean;
  installed: boolean;
  pathValid: boolean;
  accessibilityPrepared: boolean;
  uiaControlCount: number;
  configuredPath: string;
  executablePath?: string;
  checkedAt: string;
  message: string;
};

function requireIpcRenderer(feature: string) {
  if (!window.ipcRenderer) {
    throw new Error(`${feature}仅在 Electron 应用内可用。`);
  }

  return window.ipcRenderer;
}

export function getJianyingStatus() {
  return requireIpcRenderer("剪映状态").invoke(
    "jianying:service:status",
  ) as Promise<JianyingStatus>;
}

export function getJianyingConfig() {
  return requireIpcRenderer("剪映配置").invoke(
    "jianying:config:get",
  ) as Promise<JianyingConfigResult>;
}

export function saveJianyingConfig(config: Partial<JianyingConfig>) {
  return requireIpcRenderer("保存剪映配置").invoke(
    "jianying:config:save",
    config,
  ) as Promise<JianyingConfigResult>;
}

export function selectJianyingExecutable() {
  return requireIpcRenderer("选择剪映").invoke(
    "jianying:config:select-executable",
  ) as Promise<JianyingConfigResult | null>;
}

export function controlJianying(restart: boolean) {
  return requireIpcRenderer("剪映控制").invoke(
    restart ? "jianying:service:restart" : "jianying:service:start",
  ) as Promise<JianyingStatus>;
}

export function openJianyingPreset(presetName: string) {
  return requireIpcRenderer("打开剪映预设").invoke(
    "jianying:preset:open",
    presetName,
  ) as Promise<{ status: JianyingStatus }>;
}

export function selectJianyingDramaDirectory() {
  return requireIpcRenderer("选择剧目目录").invoke(
    "jianying:collection:select-directory",
  ) as Promise<string | null>;
}

export function prepareJianyingDramaCollection(dramaDirectory: string) {
  return requireIpcRenderer("生成剧集截图").invoke(
    "jianying:collection:prepare",
    dramaDirectory,
  ) as Promise<{
    screenshot: string;
    screenshots: string[];
    prepared: Array<{ draftName: string; episode: number }>;
    status: JianyingStatus;
  }>;
}
