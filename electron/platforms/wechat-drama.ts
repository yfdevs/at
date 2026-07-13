import { app, BrowserWindow, ipcMain } from 'electron'
import Store from 'electron-store'
import { mkdirSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  directoryDefaultPath,
  normalizePlatformRunDataDir,
  openExistingPath,
  playwrightBrowsersPath,
  resolveFromAppRoot,
  RuntimeController,
  selectDirectory,
} from './shared'
import { ensureBaiduNetdiskShareDownloaded } from './baidu-netdisk'

type WechatVideoRuntime = {
  getStatus: () => {
    videoAccounts: WechatVideoAccountStatus[]
  }
  focusVideoAccount?: (videoAccountId: string) => Promise<void>
  stop: () => Promise<void>
}

export type WechatVideoAccountStatus = {
  videoAccountId: string
  videoAccountName: string
  contractSubject?: string
  contractSubjectLabel?: string
  launched: boolean
  loginState: 'not-launched' | 'login-required' | 'logged-in' | 'unknown'
  pageCount: number
  activeUrl?: string
  userDataDir: string
}

export type WechatVideoServiceStatus = {
  running: boolean
  pid: number | null
  contractSubjects: Array<{ label: string; value: string }>
  videoAccounts: WechatVideoAccountStatus[]
}

export type WechatVideoConfig = {
  apiBaseUrl: string
  videoAccountContractSubjects: string
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
  baiduNetdiskDownloadRetryAttempts: string
  episodeUploadWaitTimeoutSeconds: string
  episodeUploadFailedRetryAttempts: string
  feishuBotWebhookUrl: string
}

type WechatVideoConfigResult = {
  config: WechatVideoConfig
  path: string
  restartRequired: boolean
}

type WechatVideoStore = {
  config: Partial<WechatVideoConfig> & Record<string, string | undefined>
}

const defaultWechatVideoConfig: WechatVideoConfig = {
  apiBaseUrl: 'http://180.184.76.232:19090',
  videoAccountContractSubjects: 'MINGXINGSHUO,MISU,WEITAO,HUANZOU,XIAOSHILIU',
  localEpisodeVideoRoot: '',
  closeFailedTaskPages: 'false',
  runDataDir: '.drama-runs/wechat-drama',
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
  baiduNetdiskDownloadRetryAttempts: '3',
  episodeUploadWaitTimeoutSeconds: '7200',
  episodeUploadFailedRetryAttempts: '3',
  feishuBotWebhookUrl: '',
}

const contractSubjectOptions = [
  { label: '明星说', value: 'MINGXINGSHUO' },
  { label: '米苏', value: 'MISU' },
  { label: '微淘', value: 'WEITAO' },
  { label: '幻走', value: 'HUANZOU' },
  { label: '小石榴', value: 'XIAOSHILIU' },
]

const contractSubjectAliases: Record<string, string> = {
  明星说: 'MINGXINGSHUO',
  米苏: 'MISU',
  微淘: 'WEITAO',
  幻走: 'HUANZOU',
  小石榴: 'XIAOSHILIU',
}

const invalidLogFileSegmentChars = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])

const runtimeController = new RuntimeController<WechatVideoRuntime>()
let store: Store<WechatVideoStore> | null = null

export function getWechatVideoBrowserInstanceCount() {
  return runtimeController.current
    ?.getStatus()
    .videoAccounts.filter((account) => account.launched).length ?? 0
}

export function getWechatVideoRunningPlatformCount() {
  return runtimeController.running ? 1 : 0
}

export function getWechatVideoPlatformRuntimeSummary() {
  const currentStatus = runtimeController.current?.getStatus()
  const browserInstances = currentStatus?.videoAccounts
    .filter((account) => account.launched)
    .map((account) => ({
      id: account.videoAccountId,
      label: account.videoAccountName || account.videoAccountId,
      loginState: account.loginState,
      activeUrl: account.activeUrl,
    })) ?? []

  return {
    platform: 'wechat-drama' as const,
    running: runtimeController.running,
    browserInstanceCount: browserInstances.length,
    browserInstances,
    logDir: logDirPath(),
  }
}

export function openWechatVideoLogDir() {
  const logsDir = logDirPath()
  mkdirSync(logsDir, { recursive: true })
  return openExistingPath(logsDir)
}

function readSelectedContractSubjects(config = readConfig()) {
  const selectedSubjects = new Set(
    config.videoAccountContractSubjects
      .split(',')
      .map((subject) => subject.trim())
      .filter(Boolean),
  )

  return contractSubjectOptions.filter((option) => selectedSubjects.has(option.value))
}

function formatContractSubjectLabel(value: string | undefined) {
  if (!value) return undefined
  const trimmedValue = value.trim()
  const normalizedValue = contractSubjectAliases[trimmedValue] ?? trimmedValue.toUpperCase()
  return contractSubjectOptions.find((option) => option.value === normalizedValue)?.label ?? value
}

async function status(): Promise<WechatVideoServiceStatus> {
  const runtime = runtimeController.current

  return {
    running: runtimeController.running,
    pid: runtime ? process.pid : null,
    contractSubjects: readSelectedContractSubjects(),
    videoAccounts: runtime?.getStatus().videoAccounts.map((account) => ({
      ...account,
      contractSubjectLabel: formatContractSubjectLabel(account.contractSubject),
    })) ?? [],
  }
}

function getStore() {
  if (!store) {
    store = new Store<WechatVideoStore>({
      name: 'wechat-drama-config',
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

function broadcastConfigChanged(result: WechatVideoConfigResult) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('wechat-drama:config:changed', result)
  }
}

function normalizeConfig(
  config: Partial<WechatVideoConfig> & Record<string, string | undefined>,
): WechatVideoConfig {
  return {
    apiBaseUrl: config.apiBaseUrl ?? defaultWechatVideoConfig.apiBaseUrl,
    videoAccountContractSubjects: config.videoAccountContractSubjects ?? defaultWechatVideoConfig.videoAccountContractSubjects,
    localEpisodeVideoRoot: config.localEpisodeVideoRoot ?? defaultWechatVideoConfig.localEpisodeVideoRoot,
    closeFailedTaskPages: config.closeFailedTaskPages ?? defaultWechatVideoConfig.closeFailedTaskPages,
    runDataDir:
      !config.runDataDir || config.runDataDir === '.drama-runs'
        ? defaultWechatVideoConfig.runDataDir
        : config.runDataDir,
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
    baiduNetdiskDownloadRetryAttempts: config.baiduNetdiskDownloadRetryAttempts ?? defaultWechatVideoConfig.baiduNetdiskDownloadRetryAttempts,
    episodeUploadWaitTimeoutSeconds: config.episodeUploadWaitTimeoutSeconds ?? defaultWechatVideoConfig.episodeUploadWaitTimeoutSeconds,
    episodeUploadFailedRetryAttempts: config.episodeUploadFailedRetryAttempts ?? defaultWechatVideoConfig.episodeUploadFailedRetryAttempts,
    feishuBotWebhookUrl: config.feishuBotWebhookUrl ?? defaultWechatVideoConfig.feishuBotWebhookUrl,
  }
}

function sanitizeLogFileSegment(value: string) {
  const sanitized = Array.from(value.trim(), (char) => (
    invalidLogFileSegmentChars.has(char) || char.charCodeAt(0) <= 0x1f ? '_' : char
  )).join('')
  return sanitized || 'unknown'
}

function logDirPath(config = readConfig()) {
  return path.join(resolveFromAppRoot(config.runDataDir), 'logs')
}

function findLatestVideoAccountLogFile(videoAccountId: string) {
  const logsDir = logDirPath()
  mkdirSync(logsDir, { recursive: true })

  const accountIdSegment = sanitizeLogFileSegment(videoAccountId)
  const legacyAccountLogPrefix = `app-${accountIdSegment}-`
  const accountLogSegment = `-${accountIdSegment}-`
  const latestLogFile = readdirSync(logsDir, { withFileTypes: true })
    .filter((entry) => (
      entry.isFile()
      && /\.(jsonl|log)$/i.test(entry.name)
      && (
        entry.name.startsWith(legacyAccountLogPrefix)
        || entry.name.includes(accountLogSegment)
      )
    ))
    .map((entry) => path.join(logsDir, entry.name))
    .sort((left, right) => {
      const leftMtime = statSync(left).mtimeMs
      const rightMtime = statSync(right).mtimeMs
      return rightMtime - leftMtime
    })[0]

  return latestLogFile ?? logsDir
}

function assertWechatVideoConfigReady(config = readConfig()) {
  if (!config.localEpisodeVideoRoot.trim()) {
    throw new Error('WECHAT_LOCAL_VIDEO_ROOT_REQUIRED')
  }
}

async function startRuntime() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = playwrightBrowsersPath()

  const { startWechatVideoRuntime } = await import('@drama/wechat-drama-automation')
  return startWechatVideoRuntime({
    settings: readConfig(),
    ensureBaiduNetdiskResource: ensureBaiduNetdiskShareDownloaded,
  })
}

export function registerWechatVideoPlatformHandlers() {
  ipcMain.handle('wechat-drama:config:get', () => ({
    config: readConfig(),
    path: configPath(),
    restartRequired: false,
  }))

  ipcMain.handle('wechat-drama:config:save', async (_event, config: WechatVideoConfig) => {
    const nextConfig = normalizeConfig(config)
    writeConfig(nextConfig)
    const result = {
      config: nextConfig,
      path: configPath(),
      restartRequired: runtimeController.running || runtimeController.startingPromise !== null,
    }
    broadcastConfigChanged(result)
    return result
  })

  ipcMain.handle('wechat-drama:config:select-local-episode-video-root', async (event, currentPath?: string) => {
    return selectDirectory(event, {
      title: '选择剧集视频根目录',
      defaultPath: directoryDefaultPath(currentPath, app.getPath('videos')),
      properties: ['openDirectory', 'createDirectory'],
    })
  })

  ipcMain.handle('wechat-drama:config:select-run-data-dir', async (event, currentPath?: string) => {
    const selectedPath = await selectDirectory(event, {
      title: '选择运行数据目录',
      defaultPath: directoryDefaultPath(currentPath, app.getPath('documents')),
      properties: ['openDirectory', 'createDirectory'],
    })

    return normalizePlatformRunDataDir(selectedPath, 'wechat-drama')
  })

  ipcMain.handle('wechat-drama:service:status', () => status())

  ipcMain.handle('wechat-drama:service:start', async () => {
    assertWechatVideoConfigReady()
    await runtimeController.start(startRuntime)
    return status()
  })

  ipcMain.handle('wechat-drama:service:stop', async () => {
    await runtimeController.stop()
    return status()
  })

  ipcMain.handle('wechat-drama:service:video-account:focus', async (_event, videoAccountId: string) => {
    const runtime = await runtimeController.resolveStarting()

    if (!runtime) {
      throw new Error('微信视频号服务未启动。')
    }

    let currentRuntime = runtime
    if (typeof currentRuntime.focusVideoAccount !== 'function') {
      currentRuntime = await runtimeController.replace(startRuntime)
    }

    if (typeof currentRuntime.focusVideoAccount !== 'function') {
      throw new Error('当前微信视频号服务实例不支持打开浏览器到前台，请重启应用后再试。')
    }

    await currentRuntime.focusVideoAccount(videoAccountId)
    return status()
  })

  ipcMain.handle('wechat-drama:service:video-account:open-log', async (_event, videoAccountId: string) => {
    return openExistingPath(findLatestVideoAccountLogFile(videoAccountId))
  })
}

export function stopWechatVideoPlatformRuntime() {
  runtimeController.stopInBackground()
}
