import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron'
import Store from 'electron-store'
import path from 'node:path'

type WechatVideoRuntime = {
  stop: () => Promise<void>
}

export type WechatVideoServiceStatus = {
  running: boolean
  pid: number | null
}

export type WechatVideoConfig = {
  apiBaseUrl: string
  localEpisodeVideoRoot: string
  closeFailedTaskPages: string
  runDataDir: string
  logRetentionDays: string
  workerEmptyClaimDelaySeconds: string
  workerSlowEmptyClaimThreshold: string
  workerSlowEmptyClaimDelaySeconds: string
  videoAccountSyncIntervalSeconds: string
  idlePageRefreshIntervalSeconds: string
  idlePageRefreshTimeoutSeconds: string
  idlePageRefreshJitterSeconds: string
  basicInfoStepTimeoutSeconds: string
  remoteFileDownloadTimeoutSeconds: string
  episodeUploadWaitTimeoutSeconds: string
  episodeUploadFailedRetryAttempts: string
  feishuBotWebhookUrl: string
}

type WechatVideoStore = {
  config: Partial<WechatVideoConfig> & Record<string, string | undefined>
}

const defaultWechatVideoConfig: WechatVideoConfig = {
  apiBaseUrl: 'http://180.184.76.232:19090',
  localEpisodeVideoRoot: '',
  closeFailedTaskPages: 'false',
  runDataDir: '.drama-runs',
  logRetentionDays: '3',
  workerEmptyClaimDelaySeconds: '5',
  workerSlowEmptyClaimThreshold: '30',
  workerSlowEmptyClaimDelaySeconds: '30',
  videoAccountSyncIntervalSeconds: '600',
  idlePageRefreshIntervalSeconds: '10800',
  idlePageRefreshTimeoutSeconds: '60',
  idlePageRefreshJitterSeconds: '300',
  basicInfoStepTimeoutSeconds: '600',
  remoteFileDownloadTimeoutSeconds: '120',
  episodeUploadWaitTimeoutSeconds: '7200',
  episodeUploadFailedRetryAttempts: '3',
  feishuBotWebhookUrl: '',
}

let runtime: WechatVideoRuntime | null = null
let runtimeStarting: Promise<WechatVideoRuntime> | null = null
let store: Store<WechatVideoStore> | null = null

function status(): WechatVideoServiceStatus {
  return {
    running: runtime !== null,
    pid: runtime ? process.pid : null,
  }
}

function getStore() {
  if (!store) {
    store = new Store<WechatVideoStore>({
      name: 'wechat-video-config',
      defaults: {
        config: defaultWechatVideoConfig,
      },
    })
  }

  return store
}

function configPath() {
  return getStore().path
}

function readConfig(): WechatVideoConfig {
  return normalizeConfig(getStore().get('config'))
}

function writeConfig(config: WechatVideoConfig) {
  getStore().set('config', config)
}

async function selectDirectory(event: IpcMainInvokeEvent, options: OpenDialogOptions) {
  const parentWindow = BrowserWindow.fromWebContents(event.sender)
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options)

  return result.canceled ? null : result.filePaths[0] ?? null
}

function directoryDefaultPath(currentPath: string | undefined, fallback: string) {
  const trimmedPath = currentPath?.trim()

  if (!trimmedPath) {
    return fallback
  }

  return path.isAbsolute(trimmedPath)
    ? trimmedPath
    : path.join(process.env.APP_ROOT, trimmedPath)
}

function normalizeConfig(
  config: Partial<WechatVideoConfig> & Record<string, string | undefined>,
): WechatVideoConfig {
  return {
    apiBaseUrl: config.apiBaseUrl ?? defaultWechatVideoConfig.apiBaseUrl,
    localEpisodeVideoRoot: config.localEpisodeVideoRoot ?? defaultWechatVideoConfig.localEpisodeVideoRoot,
    closeFailedTaskPages: config.closeFailedTaskPages ?? defaultWechatVideoConfig.closeFailedTaskPages,
    runDataDir: config.runDataDir ?? defaultWechatVideoConfig.runDataDir,
    logRetentionDays: config.logRetentionDays ?? defaultWechatVideoConfig.logRetentionDays,
    workerEmptyClaimDelaySeconds: config.workerEmptyClaimDelaySeconds ?? defaultWechatVideoConfig.workerEmptyClaimDelaySeconds,
    workerSlowEmptyClaimThreshold: config.workerSlowEmptyClaimThreshold ?? defaultWechatVideoConfig.workerSlowEmptyClaimThreshold,
    workerSlowEmptyClaimDelaySeconds: config.workerSlowEmptyClaimDelaySeconds ?? defaultWechatVideoConfig.workerSlowEmptyClaimDelaySeconds,
    videoAccountSyncIntervalSeconds: config.videoAccountSyncIntervalSeconds ?? defaultWechatVideoConfig.videoAccountSyncIntervalSeconds,
    idlePageRefreshIntervalSeconds: config.idlePageRefreshIntervalSeconds ?? defaultWechatVideoConfig.idlePageRefreshIntervalSeconds,
    idlePageRefreshTimeoutSeconds: config.idlePageRefreshTimeoutSeconds ?? defaultWechatVideoConfig.idlePageRefreshTimeoutSeconds,
    idlePageRefreshJitterSeconds: config.idlePageRefreshJitterSeconds ?? defaultWechatVideoConfig.idlePageRefreshJitterSeconds,
    basicInfoStepTimeoutSeconds: config.basicInfoStepTimeoutSeconds ?? defaultWechatVideoConfig.basicInfoStepTimeoutSeconds,
    remoteFileDownloadTimeoutSeconds: config.remoteFileDownloadTimeoutSeconds ?? defaultWechatVideoConfig.remoteFileDownloadTimeoutSeconds,
    episodeUploadWaitTimeoutSeconds: config.episodeUploadWaitTimeoutSeconds ?? defaultWechatVideoConfig.episodeUploadWaitTimeoutSeconds,
    episodeUploadFailedRetryAttempts: config.episodeUploadFailedRetryAttempts ?? defaultWechatVideoConfig.episodeUploadFailedRetryAttempts,
    feishuBotWebhookUrl: config.feishuBotWebhookUrl ?? defaultWechatVideoConfig.feishuBotWebhookUrl,
  }
}

function playwrightBrowsersPath() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    return process.env.PLAYWRIGHT_BROWSERS_PATH
  }

  return app.isPackaged
    ? path.join(process.resourcesPath, 'playwright-browsers')
    : path.join(process.env.APP_ROOT, '.cache', 'playwright-browsers')
}

async function startRuntime() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = playwrightBrowsersPath()

  const runtimePackage = '@drama/wechat-video-automation/runtime'
  const { startWechatVideoRuntime } = await import(/* @vite-ignore */ runtimePackage)
  return startWechatVideoRuntime({
    settings: readConfig(),
  })
}

export function registerWechatVideoPlatformHandlers() {
  ipcMain.handle('wechat-video:config:get', () => ({
    config: readConfig(),
    path: configPath(),
    restartRequired: false,
  }))

  ipcMain.handle('wechat-video:config:save', async (_event, config: WechatVideoConfig) => {
    const nextConfig = normalizeConfig(config)
    writeConfig(nextConfig)
    return {
      config: nextConfig,
      path: configPath(),
      restartRequired: runtime !== null || runtimeStarting !== null,
    }
  })

  ipcMain.handle('wechat-video:config:select-local-episode-video-root', async (event, currentPath?: string) => {
    return selectDirectory(event, {
      title: '选择剧集视频根目录',
      defaultPath: directoryDefaultPath(currentPath, app.getPath('videos')),
      properties: ['openDirectory', 'createDirectory'],
    })
  })

  ipcMain.handle('wechat-video:config:select-run-data-dir', async (event, currentPath?: string) => {
    return selectDirectory(event, {
      title: '选择运行数据目录',
      defaultPath: directoryDefaultPath(currentPath, app.getPath('documents')),
      properties: ['openDirectory', 'createDirectory'],
    })
  })

  ipcMain.handle('wechat-video:service:status', () => status())

  ipcMain.handle('wechat-video:service:start', async () => {
    if (runtime) return status()

    if (!runtimeStarting) {
      runtimeStarting = startRuntime()
    }

    try {
      runtime = await runtimeStarting
    } finally {
      runtimeStarting = null
    }

    return status()
  })

  ipcMain.handle('wechat-video:service:stop', async () => {
    if (runtimeStarting) {
      runtime = await runtimeStarting
      runtimeStarting = null
    }

    if (runtime) {
      await runtime.stop()
      runtime = null
    }

    return status()
  })
}

export function stopWechatVideoPlatformRuntime() {
  void runtime?.stop()
  runtime = null
}
