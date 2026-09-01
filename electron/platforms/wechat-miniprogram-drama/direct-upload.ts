import { BrowserWindow, ipcMain } from "electron"
import { attachTitlebarToWindow } from "custom-electron-titlebar/main"
import { createHash } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type {
  WechatMiniProgramDirectUploadRuntime,
  WechatMiniProgramRuntimeSettings,
} from "@drama/wechat-miniprogram-drama-automation"
import { ensureBaiduNetdiskShareDownloaded } from "../baidu-netdisk"
import { createElectronPlatformLogger } from "../../platform-logger"
import { resolveFromAppRoot } from "../shared"
import { WechatMiniProgramDirectUploadTaskRepository } from "../../storage/wechat-miniprogram-drama/direct-upload-repository"
import type { WechatMiniProgramDirectUploadTask } from "../../storage/wechat-miniprogram-drama/direct-upload-types"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const directUploadWindowMode = "wechat-miniprogram-baidu-upload"

type DirectUploadSettings = Partial<WechatMiniProgramRuntimeSettings> & {
  localEpisodeVideoRoot: string
  runDataDir: string
}

export type WechatMiniProgramDirectUploadWorkspace = {
  queue: {
    running: boolean
    activeTaskId?: string
    error?: string
  }
  browser: {
    launched: boolean
    loginState: "not-launched" | "login-required" | "logged-in" | "unknown"
    activeUrl?: string
  }
  tasks: WechatMiniProgramDirectUploadTask[]
  databasePath: string
}

export class WechatMiniProgramDirectUploadCoordinator {
  private readonly repository = new WechatMiniProgramDirectUploadTaskRepository()
  private runtime: WechatMiniProgramDirectUploadRuntime | null = null
  private queueRunning = false
  private queueError: string | undefined
  private activeTaskId: string | undefined
  private workerPromise: Promise<void> | null = null
  private window: BrowserWindow | null = null

  constructor(
    private readonly options: {
      getSettings: () => DirectUploadSettings
      regularServiceRunning: () => boolean
      playwrightBrowsersPath: () => string
    },
  ) {
    this.repository.recoverInterrupted()
  }

  registerHandlers(): void {
    ipcMain.handle("wechat-miniprogram-drama:baidu-upload:window:open", async () => {
      this.openWindow()
      this.autoStartQueue()
      return this.refreshWorkspace()
    })
    ipcMain.handle(
      "wechat-miniprogram-drama:baidu-upload:workspace:get",
      () => this.refreshWorkspace(),
    )
    ipcMain.handle(
      "wechat-miniprogram-drama:baidu-upload:task:create",
      (_event, input: { dramaName?: string; shareText?: string }) => this.createTask(input),
    )
    ipcMain.handle(
      "wechat-miniprogram-drama:baidu-upload:task:retry",
      (_event, id: string) => {
        this.repository.retry(id)
        this.autoStartQueue()
        return this.workspace()
      },
    )
    ipcMain.handle(
      "wechat-miniprogram-drama:baidu-upload:task:delete",
      (_event, id: string) => {
        if (this.activeTaskId === id) throw new Error("正在执行的任务不能删除。")
        this.repository.delete(id)
        this.broadcast()
        return this.workspace()
      },
    )
    ipcMain.handle("wechat-miniprogram-drama:baidu-upload:queue:start", () => {
      try {
        this.startQueue()
      } catch (error) {
        this.queueError = error instanceof Error ? error.message : String(error)
        this.broadcast()
        throw error
      }
      return this.workspace()
    })
    ipcMain.handle("wechat-miniprogram-drama:baidu-upload:queue:pause", () => {
      this.queueRunning = false
      this.broadcast()
      return this.workspace()
    })
    ipcMain.handle("wechat-miniprogram-drama:baidu-upload:browser:focus", async () => {
      await this.focusBrowser()
      return this.workspace()
    })
    ipcMain.handle("wechat-miniprogram-drama:baidu-upload:browser:close", async () => {
      if (this.activeTaskId) throw new Error("任务上传期间不能关闭浏览器。")
      await this.runtime?.closeBrowser()
      this.broadcast()
      return this.workspace()
    })
  }

  workspace(): WechatMiniProgramDirectUploadWorkspace {
    return {
      queue: {
        running: this.queueRunning,
        activeTaskId: this.activeTaskId,
        error: this.queueError,
      },
      browser: this.runtime?.getStatus() ?? {
        launched: false,
        loginState: "not-launched",
      },
      tasks: this.repository.list(),
      databasePath: this.repository.databasePath,
    }
  }

  isBrowserLaunched(): boolean {
    return this.runtime?.getStatus().launched ?? false
  }

  isActive(): boolean {
    return this.queueRunning || Boolean(this.activeTaskId) || this.isBrowserLaunched()
  }

  getBrowserInstanceCount(): number {
    return this.isBrowserLaunched() ? 1 : 0
  }

  async focusBrowser(): Promise<void> {
    this.assertDirectModeAvailable()
    await this.ensureRuntime().then((runtime) => runtime.focusBrowser())
    this.autoStartQueue()
    this.broadcast()
  }

  async stop(): Promise<void> {
    this.queueRunning = false
    await this.runtime?.stop().catch(() => undefined)
    this.runtime = null
    this.window?.destroy()
    this.window = null
  }

  private createTask(input: { dramaName?: string; shareText?: string }) {
    const dramaName = String(input.dramaName ?? "").trim()
    const shareText = String(input.shareText ?? "").trim()
    if (!dramaName) throw new Error("请填写剧目名称。")
    if (!shareText) throw new Error("请粘贴百度网盘分享内容。")
    if (!/https?:\/\/pan\.baidu\.com\/s\//i.test(shareText)) {
      throw new Error("分享内容中没有找到有效的百度网盘链接。")
    }
    const shareKey = createHash("sha256").update(shareText).digest("hex").slice(0, 24)
    this.repository.create({ dramaName, shareText, shareKey })
    this.autoStartQueue()
    return this.workspace()
  }

  private startQueue(): void {
    this.assertDirectModeAvailable()
    const settings = this.options.getSettings()
    if (!settings.localEpisodeVideoRoot.trim()) {
      throw new Error("请先在微信小程序配置中设置剧集视频根目录。")
    }
    if (this.queueRunning) return
    this.queueError = undefined
    this.queueRunning = true
    this.broadcast()
    this.startWorkerIfNeeded()
  }

  private startWorkerIfNeeded(): void {
    if (this.workerPromise) return
    this.workerPromise = this.runQueue().finally(() => {
      this.workerPromise = null
      if (this.queueRunning && this.repository.findNextQueued()) {
        this.startWorkerIfNeeded()
      }
    })
  }

  private autoStartQueue(): void {
    if (!this.repository.findNextQueued()) return
    try {
      this.startQueue()
    } catch (error) {
      this.queueError = error instanceof Error ? error.message : String(error)
      this.broadcast()
    }
  }

  private async refreshWorkspace(): Promise<WechatMiniProgramDirectUploadWorkspace> {
    await this.runtime?.refreshStatus().catch(() => undefined)
    return this.workspace()
  }

  private async runQueue(): Promise<void> {
    while (this.queueRunning) {
      const task = this.repository.findNextQueued()
      if (!task) {
        this.queueRunning = false
        break
      }

      this.activeTaskId = task.id
      this.broadcast()
      await this.processTask(task)
      this.activeTaskId = undefined
      this.broadcast()
    }
    this.activeTaskId = undefined
    this.broadcast()
  }

  private async processTask(task: WechatMiniProgramDirectUploadTask): Promise<void> {
    const logger = this.logger(task)
    const startedAt = new Date().toISOString()
    try {
      const settings = this.options.getSettings()
      this.repository.update(task.id, {
        state: "inspecting",
        error: undefined,
        startedAt,
        finishedAt: undefined,
      })
      this.broadcast()

      this.repository.update(task.id, { state: "downloading" })
      this.broadcast()
      logger.info("开始检查并下载百度网盘剧集")
      const download = await ensureBaiduNetdiskShareDownloaded({
        requesterPlatform: "wechat-miniprogram-drama-direct-upload",
        shareText: task.shareText,
        resourceName: task.dramaName,
        localEpisodeVideoRoot: settings.localEpisodeVideoRoot,
        inferEpisodeCount: true,
        downloadEpisodeVideos: true,
        downloadAssetMaterials: false,
        requiredOwnership: { minimumImages: 0 },
        requiredOwnershipFiles: 0,
        requiredPosterImages: 0,
        requiredAiProductionProofFiles: 0,
      })
      const episodeCount = Number(download.episodeCount)
      if (!Number.isInteger(episodeCount) || episodeCount <= 0) {
        throw new Error("百度网盘资源下载完成，但未能确定有效总集数。")
      }

      const {
        findLocalEpisodeVideos,
        prepareEpisodeVideos,
        VideoTranscodeQueue,
      } = await import("@drama/drama-media-assets")
      const downloadedEpisodeVideos = await findLocalEpisodeVideos({
        localEpisodeVideoRoot: settings.localEpisodeVideoRoot,
        resourceName: task.dramaName,
      })
      const episodeIndexes = downloadedEpisodeVideos.map((episode) => episode.index)
      const expectedIndexes = Array.from({ length: episodeCount }, (_, index) => index + 1)
      if (
        episodeIndexes.length !== expectedIndexes.length
        || episodeIndexes.some((value, index) => value !== expectedIndexes[index])
      ) {
        throw new Error(
          `本地下载后的剧集校验失败：期望1-${episodeCount}，实际${episodeIndexes.join("、") || "无"}。`,
        )
      }

      const maxFileMegabytes = Math.max(
        1,
        Math.floor(Number(settings.episodeVideoMaxFileMegabytes) || 490),
      )
      const targetFileMegabytes = Math.max(
        1,
        Math.floor(Number(settings.episodeVideoTargetFileMegabytes) || 480),
      )
      if (targetFileMegabytes >= maxFileMegabytes) {
        throw new Error("视频压缩目标体积必须小于单集视频上限。")
      }
      const videoTranscodeQueue = new VideoTranscodeQueue({
        concurrency: Math.max(
          1,
          Math.floor(Number(settings.videoTranscodeConcurrency) || 2),
        ),
        onLog: (message) => logger.info(message),
      })
      const episodeVideos = await prepareEpisodeVideos({
        episodes: downloadedEpisodeVideos,
        queue: videoTranscodeQueue,
        cacheRootDir: path.join(
          resolveFromAppRoot(settings.runDataDir),
          "media-cache",
          "video-transcodes",
        ),
        policy: {
          maxFileBytes: maxFileMegabytes * 1_000_000,
          targetFileBytes: targetFileMegabytes * 1_000_000,
          audioBitrateKbps: 128,
          threadsPerJob: Math.max(
            1,
            Math.floor(Number(settings.videoTranscodeThreadsPerJob) || 2),
          ),
        },
        replaceSource: true,
        onLog: (message) => logger.info(message),
      })

      this.repository.update(task.id, {
        state: "waiting-login",
        inferredEpisodeCount: episodeCount,
        episodeIndexes,
        localPath: download.localPath,
        uploadTotalCount: episodeCount,
        uploadCompletedCount: 0,
      })
      this.broadcast()

      const runtime = await this.ensureRuntime()
      await runtime.upload({
        resourceName: task.dramaName,
        dramaName: task.dramaName,
        episodeCount,
        episodeVideos,
        onAuthenticated: () => {
          this.repository.update(task.id, {
            state: "uploading",
            uploadAccountLabel: "当前登录的微信小程序账号",
          })
          this.broadcast()
        },
        onProgress: ({ completed, total }) => {
          this.repository.update(task.id, {
            state: "uploading",
            uploadCompletedCount: completed,
            uploadTotalCount: total,
          })
          this.broadcast()
        },
      })

      this.repository.update(task.id, {
        state: "completed",
        uploadCompletedCount: episodeCount,
        uploadTotalCount: episodeCount,
        finishedAt: new Date().toISOString(),
      })
      logger.info("百度资源直传任务完成", { episodeCount })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const loginRequired = this.runtime?.getStatus().loginState === "login-required"
        || /登录|login/i.test(message)
      this.repository.update(task.id, {
        state: loginRequired ? "interrupted" : "failed",
        error: message,
        finishedAt: new Date().toISOString(),
      })
      if (loginRequired) this.queueRunning = false
      logger.error("百度资源直传任务失败", { errorMessage: message })
    }
  }

  private assertDirectModeAvailable(): void {
    if (this.options.regularServiceRunning()) {
      throw new Error("微信小程序常规服务正在运行，请先关闭常规服务再使用百度资源直传。")
    }
  }

  private async ensureRuntime(): Promise<WechatMiniProgramDirectUploadRuntime> {
    this.assertDirectModeAvailable()
    if (this.runtime) return this.runtime
    process.env.PLAYWRIGHT_BROWSERS_PATH = this.options.playwrightBrowsersPath()
    const { startWechatMiniProgramDirectUploadRuntime } = await import(
      "@drama/wechat-miniprogram-drama-automation"
    )
    const settings = this.options.getSettings()
    this.runtime = startWechatMiniProgramDirectUploadRuntime({
      settings,
      userDataDir: path.join(
        resolveFromAppRoot(settings.runDataDir),
        "auth",
        "baidu-direct-upload",
      ),
    })
    return this.runtime
  }

  private openWindow(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show()
      this.window.focus()
      return
    }

    const window = new BrowserWindow({
      width: 1000,
      height: 720,
      minWidth: 860,
      minHeight: 600,
      show: false,
      title: "微信小程序 · 百度资源直传",
      titleBarStyle: "hidden",
      autoHideMenuBar: true,
      backgroundColor: "#fafafa",
      webPreferences: {
        preload: path.join(__dirname, "preload.mjs"),
        sandbox: false,
      },
    })
    this.window = window
    attachTitlebarToWindow(window)
    window.setMenu(null)
    window.once("ready-to-show", () => window.show())
    window.on("closed", () => {
      if (this.window === window) this.window = null
    })

    const devServerUrl = process.env.VITE_DEV_SERVER_URL
    if (devServerUrl) {
      const url = new URL(devServerUrl)
      url.searchParams.set("window", directUploadWindowMode)
      void window.loadURL(url.toString())
    } else {
      void window.loadFile(
        path.join(process.env.APP_ROOT ?? path.join(__dirname, "..", ".."), "dist", "index.html"),
        { query: { window: directUploadWindowMode } },
      )
    }
  }

  private broadcast(): void {
    const workspace = this.workspace()
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(
        "wechat-miniprogram-drama:baidu-upload:workspace:changed",
        workspace,
      )
    }
  }

  private logger(task: WechatMiniProgramDirectUploadTask) {
    const settings = this.options.getSettings()
    return createElectronPlatformLogger({
      platform: "wechat-miniprogram-drama",
      scope: "baidu-direct-upload",
      context: { taskId: task.id, dramaName: task.dramaName },
      logDir: path.join(resolveFromAppRoot(settings.runDataDir), "logs"),
      retentionDays: Number.parseInt(settings.logRetentionDays ?? "3", 10) || 3,
    })
  }
}
