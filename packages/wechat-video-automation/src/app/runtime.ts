import { BrowserContextManager } from "../automation/browser-context-manager.js";
import { FeishuNotifier } from "../shared/feishu-notifier.js";
import { loadServiceConfig } from "../shared/config.js";
import { configureWechatVideoRuntimeSettings, type WechatVideoRuntimeSettings } from "../shared/runtime-settings.js";
import { IdlePageRefreshService } from "./idle-page-refresh-service.js";
import { TaskService } from "./task-service.js";
import { TaskWorkerPool } from "./task-worker-pool.js";
import { VideoAccountSyncService } from "./video-account-sync-service.js";

export type WechatVideoRuntime = {
  stop: () => Promise<void>;
}

export type WechatVideoRuntimeOptions = {
  onLog?: (message: string) => void;
  settings?: Partial<WechatVideoRuntimeSettings>;
}

function log(options: WechatVideoRuntimeOptions, message: string) {
  console.log(message);
  options.onLog?.(message);
}

export async function startWechatVideoRuntime(options: WechatVideoRuntimeOptions = {}): Promise<WechatVideoRuntime> {
  configureWechatVideoRuntimeSettings(options.settings);
  const serviceConfig = await loadServiceConfig();
  const notifier = new FeishuNotifier();
  const browserContexts = new BrowserContextManager(serviceConfig, notifier);
  await browserContexts.initialize();

  const taskService = new TaskService(browserContexts, notifier);
  const taskWorkerPool = new TaskWorkerPool(serviceConfig, browserContexts, taskService, notifier);
  const idlePageRefreshService = new IdlePageRefreshService(serviceConfig, browserContexts, taskService);
  const videoAccountSyncService = new VideoAccountSyncService(
    serviceConfig,
    browserContexts,
    taskWorkerPool,
    idlePageRefreshService,
  );

  log(options, "[runtime] initialized video accounts:");
  for (const videoAccount of serviceConfig.videoAccounts) {
    log(
      options,
      `[runtime] - id=${videoAccount.id} name=${videoAccount.name} contractSubject=${
        videoAccount.contractSubject ?? "-"
      }`,
    );
  }

  taskWorkerPool.start();
  videoAccountSyncService.start();
  idlePageRefreshService.start();
  log(options, "[runtime] started");

  return {
    async stop() {
      log(options, "[runtime] stopping");
      idlePageRefreshService.stop();
      videoAccountSyncService.stop();
      taskWorkerPool.stop();
      await browserContexts.close();
      log(options, "[runtime] stopped");
    },
  };
}
