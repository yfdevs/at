import { app, BrowserWindow, dialog, ipcMain, Notification } from "electron";
import { attachTitlebarToWindow } from "custom-electron-titlebar/main";
import Store from "electron-store";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  assertGlobalDirectoriesConfigured,
  createConfiguredAiClient,
  resolveGlobalPlatformDirectories,
} from "../global-app-config";
import { registerRuntimeAssetCleanupRoot } from "../runtime-asset-cleanup";
import { openAutomationDatabase } from "../storage/database";
import {
  TaobaoImportedTasksRepository,
  type TaobaoImportedTask,
  type TaobaoImportedTaskSummary,
} from "../storage/taobao-drama/imported-tasks-repository";
import { ensureBaiduNetdiskShareDownloaded } from "./baidu-netdisk";
import { aggregateTaskAnalytics } from "./task-analytics";
import {
  directoryDefaultPath,
  normalizePlatformRunDataDir,
  openExistingPath,
  playwrightBrowsersPath,
  resolveFromAppRoot,
  RuntimeController,
  selectDirectory,
} from "./shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type RuntimeStatus = {
  platform: "taobao-drama";
  running: boolean;
  loginState: "login-required" | "verification-required" | "logged-in" | "unknown";
  activeUrl?: string;
  batchPublishUrl: string;
  loginUrl: string;
  userDataDir: string;
  lastTask?: {
    taskId: string;
    originalTitle?: string;
    status: "running" | "succeeded" | "failed";
    errorMessage?: string;
    updatedAt: string;
  };
};

type Runtime = { getStatus: () => RuntimeStatus; stop: () => Promise<void> };

export type TaobaoDramaConfig = {
  accountProfileName: string;
  headless: string;
  operationDelaySeconds: string;
  baiduNetdiskDownloadRetryAttempts: string;
  episodeUploadWaitTimeoutMinutes: string;
  closeFailedTaskPages: string;
  runDataDir: string;
  logRetentionDays: string;
};

type StoragePaths = {
  runDataDir: string;
  accountDir: string;
  userDataDir: string;
  credentialStatePath: string;
  assetDownloadDir: string;
  logDir: string;
  logFilePath: string;
};

export type TaobaoDramaServiceStatus = RuntimeStatus & {
  pid: number | null;
  queue: TaobaoImportedTaskSummary;
};

const batchPublishUrl =
  "https://creator.guanghe.taobao.com/page/unify/creation-tool/batch-publish" +
  "?ugc_scene=short_drama_multipublish";
const loginUrl =
  "https://login.taobao.com/havanaone/login/login.htm?bizName=taobao&sub=true" +
  `&redirectURL=${encodeURIComponent(batchPublishUrl)}`;
const taskDataWindowMode = "taobao-drama-task-data";

const defaults: TaobaoDramaConfig = {
  accountProfileName: "default",
  headless: "false",
  operationDelaySeconds: "0",
  baiduNetdiskDownloadRetryAttempts: "3",
  episodeUploadWaitTimeoutMinutes: "120",
  closeFailedTaskPages: "false",
  runDataDir: "D:\\.drama-runs\\taobao-drama",
  logRetentionDays: "3",
};

const controller = new RuntimeController<Runtime>();
let store: Store<{ config: TaobaoDramaConfig }> | null = null;
let tasksRepositoryInstance: TaobaoImportedTasksRepository | null = null;
let taskDataWindow: BrowserWindow | null = null;

function openTaskDataWindow() {
  if (taskDataWindow && !taskDataWindow.isDestroyed()) {
    taskDataWindow.show();
    taskDataWindow.focus();
    return;
  }

  const nextWindow = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 880,
    minHeight: 560,
    show: false,
    title: "淘宝短剧 · 本地任务数据",
    titleBarStyle: "hidden",
    autoHideMenuBar: true,
    backgroundColor: "#fafafa",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      sandbox: false,
    },
  });
  taskDataWindow = nextWindow;
  attachTitlebarToWindow(nextWindow);
  nextWindow.setMenu(null);
  nextWindow.once("ready-to-show", () => nextWindow.show());
  nextWindow.on("closed", () => {
    if (taskDataWindow === nextWindow) taskDataWindow = null;
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    const url = new URL(devServerUrl);
    url.searchParams.set("window", taskDataWindowMode);
    void nextWindow.loadURL(url.toString());
  } else {
    void nextWindow.loadFile(
      path.join(process.env.APP_ROOT ?? path.join(__dirname, "..", ".."), "dist", "index.html"),
      { query: { window: taskDataWindowMode } },
    );
  }
}

function configStore() {
  store ??= new Store<{ config: TaobaoDramaConfig }>({
    name: "taobao-drama-config",
    defaults: { config: defaults },
  });
  return store;
}

function tasksRepository() {
  if (!tasksRepositoryInstance) {
    const opened = openAutomationDatabase();
    tasksRepositoryInstance = new TaobaoImportedTasksRepository(
      opened.database,
      opened.databasePath,
    );
  }
  return tasksRepositoryInstance;
}

function numberText(value: string | undefined, fallback: string, minimum = 0) {
  const parsed = Number(value);
  return value?.trim() && Number.isFinite(parsed) && parsed >= minimum ? value.trim() : fallback;
}

function normalizeConfig(config: Partial<TaobaoDramaConfig>): TaobaoDramaConfig {
  return {
    accountProfileName: config.accountProfileName?.trim() || defaults.accountProfileName,
    headless: config.headless ?? defaults.headless,
    operationDelaySeconds: numberText(config.operationDelaySeconds, defaults.operationDelaySeconds),
    baiduNetdiskDownloadRetryAttempts: numberText(
      config.baiduNetdiskDownloadRetryAttempts,
      defaults.baiduNetdiskDownloadRetryAttempts,
    ),
    episodeUploadWaitTimeoutMinutes: numberText(
      config.episodeUploadWaitTimeoutMinutes,
      defaults.episodeUploadWaitTimeoutMinutes,
      1,
    ),
    closeFailedTaskPages: config.closeFailedTaskPages ?? defaults.closeFailedTaskPages,
    runDataDir: config.runDataDir?.trim() || defaults.runDataDir,
    logRetentionDays: numberText(config.logRetentionDays, defaults.logRetentionDays, 1),
  };
}

function readConfig() {
  const config = normalizeConfig(configStore().get("config"));
  const directories = resolveGlobalPlatformDirectories("taobao-drama", {
    runDataDir: config.runDataDir,
    localMaterialRoot: "",
  });
  return { ...config, ...directories };
}

function runDataDir(config: Pick<TaobaoDramaConfig, "runDataDir"> = readConfig()) {
  return resolveFromAppRoot(config.runDataDir);
}

function storagePaths(
  config: Pick<TaobaoDramaConfig, "runDataDir" | "accountProfileName"> = readConfig(),
): StoragePaths {
  const encoded = encodeURIComponent(config.accountProfileName.trim() || "default");
  const accountDir = path.join(runDataDir(config), "auth", "accounts", encoded);
  const logDir = path.join(runDataDir(config), "logs");
  return {
    runDataDir: runDataDir(config),
    accountDir,
    userDataDir: path.join(accountDir, "chromium-profile"),
    credentialStatePath: path.join(accountDir, "storage-state.json"),
    assetDownloadDir: path.join(runDataDir(config), "assets", encoded),
    logDir,
    logFilePath: path.join(logDir, `app-${new Date().toISOString().slice(0, 10)}.log`),
  };
}

function ensureDirectories(paths: StoragePaths) {
  [paths.runDataDir, paths.accountDir, paths.userDataDir, paths.assetDownloadDir, paths.logDir]
    .forEach((directory) => mkdirSync(directory, { recursive: true }));
}

function latestLog(paths = storagePaths()) {
  mkdirSync(paths.logDir, { recursive: true });
  return readdirSync(paths.logDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:log|jsonl)$/i.test(entry.name))
    .map((entry) => path.join(paths.logDir, entry.name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0] ?? paths.logDir;
}

function openPathOrParent(value: string) {
  return openExistingPath(existsSync(value) ? value : path.dirname(value));
}

async function claimNextTask() {
  return tasksRepository().claimNext();
}

async function importRuntimePackage() {
  return import("@drama/taobao-drama-automation") as Promise<{
    readTaobaoBatchUploadWorkbook: (filePath: string) => Promise<{
      tasks: Array<Pick<TaobaoImportedTask, "originalTitle" | "baiduPanResourceLink" | "episodeCount" | "sourceFileName" | "sourceSheet" | "sourceRow">>;
      issues: Array<{ sheet: string; row: number; message: string }>;
    }>;
    startTaobaoDramaRuntime: (options: Record<string, unknown>) => Promise<Runtime>;
  }>;
}

function stoppedStatus(): TaobaoDramaServiceStatus {
  const paths = storagePaths();
  return {
    platform: "taobao-drama",
    running: false,
    loginState: "unknown",
    batchPublishUrl,
    loginUrl,
    userDataDir: paths.userDataDir,
    pid: null,
    queue: tasksRepository().summary(),
  };
}

async function status(): Promise<TaobaoDramaServiceStatus> {
  const runtime = controller.current;
  if (!runtime) return stoppedStatus();
  const current = runtime.getStatus();
  if (!current.running) {
    await controller.stop();
    return stoppedStatus();
  }
  return { ...current, pid: process.pid, queue: tasksRepository().summary() };
}

async function startRuntime(): Promise<Runtime> {
  process.env.PLAYWRIGHT_BROWSERS_PATH = playwrightBrowsersPath();
  const config = readConfig();
  const paths = storagePaths(config);
  ensureDirectories(paths);
  tasksRepository().recoverInterrupted();
  const { startTaobaoDramaRuntime } = await importRuntimePackage();
  return startTaobaoDramaRuntime({
    accountProfileName: config.accountProfileName,
    accountDir: paths.accountDir,
    userDataDir: paths.userDataDir,
    credentialStatePath: paths.credentialStatePath,
    assetDownloadDir: paths.assetDownloadDir,
    logFilePath: paths.logFilePath,
    logRetentionDays: Number(config.logRetentionDays) || 3,
    localMaterialRoot: config.localMaterialRoot,
    baiduNetdiskDownloadRetryAttempts: Number(config.baiduNetdiskDownloadRetryAttempts) || 0,
    episodeUploadWaitTimeoutMinutes: Number(config.episodeUploadWaitTimeoutMinutes) || 120,
    taskPollIntervalMs: 2_000,
    closeFailedTaskPages: config.closeFailedTaskPages === "true",
    onHumanVerificationRequired: () => {
      if (!Notification.isSupported()) return;
      new Notification({
        title: "淘宝需要人工验证",
        body: "自动化任务已暂停，请在淘宝浏览器中完成滑块验证；完成后会从当前步骤继续。",
      }).show();
    },
    claimNextTask,
    updateTaskProgress: (taskId: string, progress: "downloading" | "uploading") => {
      tasksRepository().markProgress(taskId, progress);
    },
    aiClientFactory: createConfiguredAiClient,
    saveGeneratedMetadata: (taskId: string, metadata: {
      dramaTag: string;
      episodeSummaries: string[];
      synopsisText?: string;
      synopsisSource?: string;
    }) => {
      tasksRepository().saveGeneratedMetadata(taskId, metadata);
    },
    completeTask: ({ taskId, success, errorMessage }: {
      taskId: string;
      success: boolean;
      errorMessage?: string;
    }) => {
      tasksRepository().complete(taskId, success, errorMessage);
    },
    ensureBaiduNetdiskResource: (request: Parameters<typeof ensureBaiduNetdiskShareDownloaded>[0]) =>
      ensureBaiduNetdiskShareDownloaded({ ...request, requesterPlatform: "taobao-drama" }),
    config: {
      browser: {
        headless: config.headless === "true",
        slowMo: (Number(config.operationDelaySeconds) || 0) * 1_000,
      },
    },
  });
}

async function importWorkbook() {
  const selected = await dialog.showOpenDialog({
    title: "导入淘宝批量上传任务",
    properties: ["openFile"],
    filters: [{ name: "Excel 工作簿", extensions: ["xlsx", "xls"] }],
  });
  if (selected.canceled || !selected.filePaths[0]) return { canceled: true as const };
  const { readTaobaoBatchUploadWorkbook } = await importRuntimePackage();
  const parsed = await readTaobaoBatchUploadWorkbook(selected.filePaths[0]);
  const imported = tasksRepository().importTasks(parsed.tasks);
  return {
    canceled: false as const,
    imported: imported.imported,
    skipped: imported.skipped,
    issues: parsed.issues,
    fileName: path.basename(selected.filePaths[0]),
    queue: tasksRepository().summary(),
  };
}

export function getTaobaoDramaBrowserInstanceCount() {
  return controller.current?.getStatus().running ? 1 : 0;
}

export function getTaobaoDramaRunningPlatformCount() {
  return controller.current?.getStatus().running ? 1 : 0;
}

export function getTaobaoDramaPlatformRuntimeSummary() {
  const current = controller.current?.getStatus();
  const paths = storagePaths();
  return {
    platform: "taobao-drama" as const,
    running: Boolean(current?.running),
    browserInstanceCount: current?.running ? 1 : 0,
    browserInstances: current?.running ? [{
      id: "default",
      label: readConfig().accountProfileName,
      loginState: current.loginState,
      activeUrl: current.activeUrl,
    }] : [],
    logDir: paths.logDir,
  };
}

export function openTaobaoDramaLogDir() {
  const paths = storagePaths();
  ensureDirectories(paths);
  return openExistingPath(paths.logDir);
}

export function registerTaobaoDramaPlatformHandlers() {
  registerRuntimeAssetCleanupRoot({
    platform: "taobao-drama",
    rootPath: path.join(storagePaths().runDataDir, "assets"),
    maxDepth: 2,
    retentionMs: 3 * 60 * 60 * 1_000,
  });
  const analyticsChannel = "taobao-drama:analytics:get";
  ipcMain.removeHandler(analyticsChannel);
  ipcMain.handle(analyticsChannel, (_event, request?: { days?: number }) => {
    const dayCount = Math.min(90, Math.max(7, Math.floor(request?.days ?? 30)));
    const tasks = tasksRepository().list().map((task) => ({
      status: task.status,
      updateTime: task.updatedAt,
    }));
    return { days: aggregateTaskAnalytics(tasks, dayCount) };
  });
  ipcMain.handle("taobao-drama:config:get", () => ({
    config: readConfig(),
    path: configStore().path,
    storagePaths: storagePaths(),
    restartRequired: false,
  }));
  ipcMain.handle("taobao-drama:config:save", (_event, value: TaobaoDramaConfig) => {
    const config = normalizeConfig(value);
    configStore().set("config", config);
    return {
      config,
      path: configStore().path,
      storagePaths: storagePaths(config),
      restartRequired: controller.running || controller.startingPromise !== null,
    };
  });
  ipcMain.handle("taobao-drama:config:select-run-data-dir", async (event, current?: string) => {
    const selected = await selectDirectory(event, {
      title: "选择淘宝短剧运行数据目录",
      defaultPath: directoryDefaultPath(current, app.getPath("documents")),
      properties: ["openDirectory", "createDirectory"],
    });
    return normalizePlatformRunDataDir(selected, "taobao-drama");
  });
  ipcMain.handle(
    "taobao-drama:config:open-storage-path",
    (_event, key: keyof StoragePaths | "configFilePath" | "latestLog") => {
      const paths = storagePaths();
      ensureDirectories(paths);
      if (key === "configFilePath") return openPathOrParent(configStore().path);
      if (key === "latestLog") return openExistingPath(latestLog(paths));
      if (key === "credentialStatePath" || key === "logFilePath") return openPathOrParent(paths[key]);
      return openExistingPath(paths[key]);
    },
  );
  ipcMain.handle("taobao-drama:tasks:import", () => importWorkbook());
  ipcMain.handle("taobao-drama:tasks:list", () => ({
    tasks: tasksRepository().list(),
    summary: tasksRepository().summary(),
  }));
  ipcMain.handle("taobao-drama:tasks:window:open", () => {
    openTaskDataWindow();
  });
  ipcMain.handle("taobao-drama:tasks:retry", (_event, taskId: string) => {
    const retried = tasksRepository().retry(taskId);
    return { retried, summary: tasksRepository().summary() };
  });
  ipcMain.handle("taobao-drama:service:status", () => status());
  ipcMain.handle("taobao-drama:service:start", async () => {
    assertGlobalDirectoriesConfigured();
    await controller.start(startRuntime);
    return status();
  });
  ipcMain.handle("taobao-drama:service:stop", async () => {
    await controller.stop();
    return status();
  });
}

export function stopTaobaoDramaPlatformRuntime() {
  controller.stopInBackground();
}

export function stopTaobaoDramaPlatformService() {
  return controller.stop();
}
