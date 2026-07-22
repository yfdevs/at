import { BrowserContextManager, type VideoAccountRuntimeStatus } from "../automation/browser-context-manager.js";
import { FeishuNotifier } from "@drama/feishu-notifier";
import { loadServiceConfig } from "../shared/config.js";
import { createLogger } from "../shared/logger.js";
import {
  configureWechatVideoRuntimeSettings,
  getWechatVideoRuntimeSettings,
  type WechatVideoRuntimeSettings,
} from "../shared/runtime-settings.js";
import { IdlePageRefreshService } from "./idle-page-refresh-service.js";
import { TaskService } from "./task-service.js";
import { TaskWorkerPool } from "./task-worker-pool.js";
import { VideoAccountSyncService } from "./video-account-sync-service.js";

export type EnsureBaiduNetdiskResourceRequest = {
  shareText: string;
  resourceName: string;
  localEpisodeVideoRoot: string;
  episodeCount: number;
  requiredOwnership?: {
    juchuang?: number;
    jianying?: number;
  };
  mergeOwnershipMaterials?: boolean;
};

export type EnsureBaiduNetdiskResource = (
  request: EnsureBaiduNetdiskResourceRequest,
) => Promise<unknown>;

export type WechatVideoRuntime = {
  getStatus: () => WechatVideoRuntimeStatus;
  focusVideoAccount: (videoAccountId: string) => Promise<void>;
  stop: () => Promise<void>;
}

export type WechatVideoRuntimeStatus = {
  videoAccounts: VideoAccountRuntimeStatus[];
}

export type WechatVideoRuntimeOptions = {
  onLog?: (message: string) => void;
  settings?: Partial<WechatVideoRuntimeSettings>;
  ensureBaiduNetdiskResource?: EnsureBaiduNetdiskResource;
}

const logger = createLogger("runtime");

function log(options: WechatVideoRuntimeOptions, message: string) {
  options.onLog?.(message);
}

export async function startWechatVideoRuntime(options: WechatVideoRuntimeOptions = {}): Promise<WechatVideoRuntime> {
  configureWechatVideoRuntimeSettings(options.settings);
  const serviceConfig = await loadServiceConfig();
  const notifier = new FeishuNotifier({
    channelIdLabel: "videoAccountId",
    channelLabel: "视频号",
    logger,
    webhookUrl: getWechatVideoRuntimeSettings().feishuBotWebhookUrl,
  });
  const browserContexts = new BrowserContextManager(serviceConfig, notifier);
  await browserContexts.initialize();

  const taskService = new TaskService(browserContexts, notifier);
  const taskWorkerPool = new TaskWorkerPool(
    serviceConfig,
    browserContexts,
    taskService,
    notifier,
    options.ensureBaiduNetdiskResource,
  );
  const idlePageRefreshService = new IdlePageRefreshService(serviceConfig, browserContexts, taskService);
  const videoAccountSyncService = new VideoAccountSyncService(
    serviceConfig,
    browserContexts,
    taskWorkerPool,
    idlePageRefreshService,
  );

  logger.info("initialized video accounts", {
    videoAccountCount: serviceConfig.videoAccounts.length,
  });
  log(options, "[runtime] initialized video accounts");
  for (const videoAccount of serviceConfig.videoAccounts) {
    logger.info("video account loaded", {
      videoAccountId: videoAccount.id,
      videoAccountName: videoAccount.name,
      contractSubject: videoAccount.contractSubject,
    });
  }

  taskWorkerPool.start();
  videoAccountSyncService.start();
  idlePageRefreshService.start();
  logger.info("started");
  log(options, "[runtime] started");

  return {
    getStatus() {
      return {
        videoAccounts: browserContexts.getRuntimeStatuses(),
      };
    },
    async focusVideoAccount(videoAccountId: string) {
      await browserContexts.focusVideoAccount(videoAccountId);
    },
    async stop() {
      logger.info("stopping");
      log(options, "[runtime] stopping");
      idlePageRefreshService.stop();
      videoAccountSyncService.stop();
      taskWorkerPool.stop();
      await browserContexts.close();
      logger.info("stopped");
      log(options, "[runtime] stopped");
    },
  };
}
