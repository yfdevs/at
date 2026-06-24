import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron'
import Store from 'electron-store'
import path from 'node:path'
import { mem } from 'systeminformation'

type MeituanCreationRuntimeStatus = {
  platform: 'meituan-creation'
  loginUrl: string
  publishVideoUrl: string
  running: boolean
  loginState: 'login-required' | 'logged-in' | 'unknown'
  activeUrl?: string
  userDataDir: string
}

type MeituanCreationRuntime = {
  getStatus: () => MeituanCreationRuntimeStatus
  stop: () => Promise<void>
}

export type MeituanCreationConfig = {
  headless: string
  operationDelaySeconds: string
  runDataDir: string
}

export type MeituanCreationServiceStatus = MeituanCreationRuntimeStatus & {
  pid: number | null
  memory: {
    processRssBytes: number
    systemUsedBytes: number
    systemTotalBytes: number
    systemUsedPercent: number
  }
}

type MeituanCreationConfigResult = {
  config: MeituanCreationConfig
  path: string
  restartRequired: boolean
}

type MeituanCreationStore = {
  config: Partial<MeituanCreationConfig> & Record<string, string | undefined>
}

const defaultMeituanCreationConfig: MeituanCreationConfig = {
  headless: 'false',
  operationDelaySeconds: '0.02',
  runDataDir: '.drama-runs/meituan-creation',
}

let runtime: MeituanCreationRuntime | null = null
let runtimeStarting: Promise<MeituanCreationRuntime> | null = null
let store: Store<MeituanCreationStore> | null = null

function getStore() {
  if (!store) {
    store = new Store<MeituanCreationStore>({
      name: 'meituan-creation-config',
      defaults: {
        config: defaultMeituanCreationConfig,
      },
    })
  }

  return store
}

function normalizeConfig(config: Partial<MeituanCreationConfig> & Record<string, string | undefined>) {
  const legacySlowMo = Number.parseFloat(config.slowMo ?? '')
  const operationDelaySeconds =
    config.operationDelaySeconds
      ?? (Number.isFinite(legacySlowMo) ? String(legacySlowMo / 1000) : undefined)
      ?? defaultMeituanCreationConfig.operationDelaySeconds

  return {
    headless: config.headless ?? defaultMeituanCreationConfig.headless,
    operationDelaySeconds,
    runDataDir:
      !config.runDataDir || config.runDataDir === '.drama-runs'
        ? defaultMeituanCreationConfig.runDataDir
        : config.runDataDir,
  }
}

function readConfig(): MeituanCreationConfig {
  return normalizeConfig(getStore().get('config'))
}

function writeConfig(config: MeituanCreationConfig) {
  getStore().set('config', config)
}

function configPath() {
  return getStore().path
}

async function readMemoryStatus() {
  const memory = await mem()
  const systemUsedBytes = memory.total - memory.available

  return {
    processRssBytes: runtime ? process.memoryUsage().rss : 0,
    systemUsedBytes,
    systemTotalBytes: memory.total,
    systemUsedPercent: memory.total > 0 ? (systemUsedBytes / memory.total) * 100 : 0,
  }
}

async function defaultStoppedStatus(): Promise<MeituanCreationServiceStatus> {
  const userDataDir = meituanCreationUserDataDir()

  return {
    platform: 'meituan-creation',
    loginUrl: 'https://czz.meituan.com/new/login',
    publishVideoUrl: 'https://czz.meituan.com/new/publishVideo',
    running: false,
    loginState: 'unknown',
    userDataDir,
    pid: null,
    memory: await readMemoryStatus(),
  }
}

async function status(): Promise<MeituanCreationServiceStatus> {
  if (!runtime) return defaultStoppedStatus()

  return {
    ...runtime.getStatus(),
    pid: process.pid,
    memory: await readMemoryStatus(),
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

function normalizeSelectedRunDataDir(selectedPath: string | null) {
  if (!selectedPath) {
    return null
  }

  const normalizedPath = path.normalize(selectedPath)
  const selectedDirName = path.basename(normalizedPath).toLowerCase()

  if (selectedDirName === 'meituan-creation') {
    return normalizedPath
  }

  if (selectedDirName === '.drama-runs') {
    return path.join(normalizedPath, 'meituan-creation')
  }

  return path.join(normalizedPath, '.drama-runs', 'meituan-creation')
}

function resolveFromAppRoot(value: string) {
  return path.isAbsolute(value) ? value : path.join(process.env.APP_ROOT, value)
}

function meituanCreationRunDataDir(config = readConfig()) {
  return resolveFromAppRoot(config.runDataDir)
}

function meituanCreationUserDataDir() {
  return path.join(meituanCreationRunDataDir(), 'auth', 'chromium-profile')
}

function meituanCreationCredentialStatePath() {
  return path.join(meituanCreationRunDataDir(), 'auth', 'storage-state.json')
}

async function startRuntime() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = playwrightBrowsersPath()

  const config = readConfig()
  const operationDelayMs = Math.max(0, Number.parseFloat(config.operationDelaySeconds) || 0) * 1000
  const runtimePackage = '@drama/meituan-creation-automation'
  const { startMeituanCreationRuntime } = await import(/* @vite-ignore */ runtimePackage)
  return startMeituanCreationRuntime({
    userDataDir: meituanCreationUserDataDir(),
    credentialStatePath: meituanCreationCredentialStatePath(),
    config: {
      browser: {
        headless: config.headless === 'true',
        slowMo: operationDelayMs,
      },
    },
  })
}

export function registerMeituanCreationPlatformHandlers() {
  ipcMain.handle('meituan-creation:config:get', () => ({
    config: readConfig(),
    path: configPath(),
    restartRequired: false,
  }))

  ipcMain.handle('meituan-creation:config:save', (_event, config: MeituanCreationConfig): MeituanCreationConfigResult => {
    const nextConfig = normalizeConfig(config)
    writeConfig(nextConfig)
    return {
      config: nextConfig,
      path: configPath(),
      restartRequired: runtime !== null || runtimeStarting !== null,
    }
  })

  ipcMain.handle('meituan-creation:config:select-run-data-dir', async (event, currentPath?: string) => {
    const selectedPath = await selectDirectory(event, {
      title: '选择美团创作平台运行数据目录',
      defaultPath: directoryDefaultPath(currentPath, app.getPath('documents')),
      properties: ['openDirectory', 'createDirectory'],
    })

    return normalizeSelectedRunDataDir(selectedPath)
  })

  ipcMain.handle('meituan-creation:service:status', () => status())

  ipcMain.handle('meituan-creation:service:start', async () => {
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

  ipcMain.handle('meituan-creation:service:stop', async () => {
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

export function stopMeituanCreationPlatformRuntime() {
  void runtime?.stop()
  runtime = null
}
