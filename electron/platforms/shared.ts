import { app, BrowserWindow, dialog, shell, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fsSize, mem } from 'systeminformation'

export type PlatformMemoryStatus = {
  processRssBytes: number
  systemUsedBytes: number
  systemTotalBytes: number
  systemUsedPercent: number
}

export type PlatformDriveStatus = {
  mount: string
  usedBytes: number
  totalBytes: number
  availableBytes: number
  usedPercent: number
}

export class RuntimeController<TRuntime extends { stop: () => Promise<void> }> {
  private runtime: TRuntime | null = null
  private starting: Promise<TRuntime> | null = null

  get current() {
    return this.runtime
  }

  get running() {
    return this.runtime !== null
  }

  get startingPromise() {
    return this.starting
  }

  async start(factory: () => Promise<TRuntime>) {
    if (this.runtime) return this.runtime

    if (!this.starting) {
      this.starting = factory()
    }

    try {
      this.runtime = await this.starting
      return this.runtime
    } finally {
      this.starting = null
    }
  }

  async resolveStarting() {
    if (this.starting) {
      this.runtime = await this.starting
      this.starting = null
    }

    return this.runtime
  }

  async replace(factory: () => Promise<TRuntime>) {
    await this.stop()
    this.runtime = await factory()
    return this.runtime
  }

  async stop() {
    try {
      await this.resolveStarting()
    } catch {
      this.starting = null
    }

    if (this.runtime) {
      await this.runtime.stop()
      this.runtime = null
    }
  }

  stopInBackground() {
    void this.runtime?.stop()
    this.runtime = null
    this.starting = null
  }
}

export async function readMemoryStatus(processRssBytes = process.memoryUsage().rss): Promise<PlatformMemoryStatus> {
  const memory = await mem()
  const systemUsedBytes = memory.total - memory.available

  return {
    processRssBytes,
    systemUsedBytes,
    systemTotalBytes: memory.total,
    systemUsedPercent: memory.total > 0 ? (systemUsedBytes / memory.total) * 100 : 0,
  }
}

export async function readDriveStatus(targetMount = 'D:'): Promise<PlatformDriveStatus | null> {
  let driveList: Awaited<ReturnType<typeof fsSize>>

  try {
    driveList = await fsSize()
  } catch {
    return null
  }

  const normalizedTargetMount = normalizeDriveMount(targetMount)
  const drive = driveList.find((item) => normalizeDriveMount(item.mount) === normalizedTargetMount)

  if (!drive) {
    return null
  }

  return {
    mount: drive.mount,
    usedBytes: drive.used,
    totalBytes: drive.size,
    availableBytes: drive.available,
    usedPercent: Number.isFinite(drive.use) ? drive.use : drive.size > 0 ? (drive.used / drive.size) * 100 : 0,
  }
}

function normalizeDriveMount(mount: string) {
  return mount.trim().replace(/[\\/]+$/, '').toUpperCase()
}

export async function selectDirectory(event: IpcMainInvokeEvent, options: OpenDialogOptions) {
  const parentWindow = BrowserWindow.fromWebContents(event.sender)
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options)

  return result.canceled ? null : result.filePaths[0] ?? null
}

export function directoryDefaultPath(currentPath: string | undefined, fallback: string) {
  const trimmedPath = currentPath?.trim()

  if (!trimmedPath) {
    return fallback
  }

  return path.isAbsolute(trimmedPath)
    ? trimmedPath
    : path.join(process.env.APP_ROOT, trimmedPath)
}

export function normalizePlatformRunDataDir(selectedPath: string | null, platformDirName: string) {
  if (!selectedPath) {
    return null
  }

  const normalizedPath = path.normalize(selectedPath)
  const selectedDirName = path.basename(normalizedPath).toLowerCase()
  const normalizedPlatformDirName = platformDirName.toLowerCase()

  if (selectedDirName === normalizedPlatformDirName) {
    return normalizedPath
  }

  if (selectedDirName === '.drama-runs') {
    return path.join(normalizedPath, platformDirName)
  }

  return path.join(normalizedPath, '.drama-runs', platformDirName)
}

export function resolveFromAppRoot(value: string) {
  return path.isAbsolute(value) ? value : path.join(process.env.APP_ROOT, value)
}

export function playwrightBrowsersPath() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    return process.env.PLAYWRIGHT_BROWSERS_PATH
  }

  return app.isPackaged
    ? path.join(process.resourcesPath, 'playwright-browsers')
    : path.join(process.env.APP_ROOT, '.cache', 'playwright-browsers')
}

export async function openExistingPath(targetPath: string) {
  const errorMessage = existsSync(targetPath)
    ? await shell.openPath(targetPath)
    : `路径不存在：${targetPath}`

  if (errorMessage) {
    throw new Error(errorMessage)
  }

  return targetPath
}
