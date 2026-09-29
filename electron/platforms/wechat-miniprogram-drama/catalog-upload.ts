import { BrowserWindow, ipcMain } from "electron"
import { attachTitlebarToWindow } from "custom-electron-titlebar/main"
import { openAsBlob } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { ensureBaiduNetdiskShareDownloaded } from "../baidu-netdisk"
import { createElectronPlatformLogger } from "../../platform-logger"
import { resolveFromAppRoot } from "../shared"
import { WechatMiniProgramCatalogUploadTaskRepository } from "../../storage/wechat-miniprogram-drama/catalog-upload-repository"
import type {
  WechatMiniProgramCatalogEpisodeStatus,
  WechatMiniProgramCatalogUploadTask,
} from "../../storage/wechat-miniprogram-drama/catalog-upload-types"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const windowMode = "wechat-miniprogram-catalog-upload"
const pageSize = 10
const requestedEpisodeCount = 4

type Settings = {
  catalogApiBaseUrl: string
  materialUploadApiBaseUrl: string
  catalogAuthorizationToken: string
  localEpisodeVideoRoot: string
  runDataDir: string
  logRetentionDays?: string
}

type CatalogDrama = {
  id: number
  wxDramaId?: number | null
  name: string
  episodeCount: number
  baiduNetdiskUrl?: string | null
}

type MaterialView = {
  id?: number
  fileName?: string
  materialId?: string
  dramaId?: number
  episodeNo?: number
}

type ApiResponse<T> = {
  code: number
  message?: string
  data: T
}

type DramaPage = {
  items: CatalogDrama[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export type WechatMiniProgramCatalogUploadWorkspace = {
  queue: {
    running: boolean
    activeTaskId?: string
    currentPage: number
    totalPages?: number
    error?: string
  }
  tasks: WechatMiniProgramCatalogUploadTask[]
  databasePath: string
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function authorizationValue(token: string): string {
  const trimmed = token.trim()
  return /^Bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`
}

function apiUrl(baseUrl: string, pathname: string): URL {
  return new URL(pathname, `${baseUrl.replace(/\/+$/, "")}/`)
}

function abortError(message: string): Error {
  const error = new Error(message)
  error.name = "AbortError"
  return error
}

function videoContentType(file: string): string {
  return path.extname(file).toLowerCase() === ".mov" ? "video/quicktime" : "video/mp4"
}

export class WechatMiniProgramCatalogUploadCoordinator {
  private readonly repository = new WechatMiniProgramCatalogUploadTaskRepository()
  private queueRunning = false
  private queueError: string | undefined
  private activeTaskId: string | undefined
  private currentPage = 0
  private totalPages: number | undefined
  private workerPromise: Promise<void> | null = null
  private abortController: AbortController | null = null
  private window: BrowserWindow | null = null

  constructor(private readonly options: { getSettings: () => Settings }) {
    this.repository.recoverInterrupted()
  }

  registerHandlers(): void {
    ipcMain.handle("wechat-miniprogram-drama:catalog-upload:window:open", () => {
      this.openWindow()
      return this.workspace()
    })
    ipcMain.handle(
      "wechat-miniprogram-drama:catalog-upload:workspace:get",
      () => this.workspace(),
    )
    ipcMain.handle("wechat-miniprogram-drama:catalog-upload:queue:start", () => {
      this.startQueue()
      return this.workspace()
    })
    ipcMain.handle("wechat-miniprogram-drama:catalog-upload:queue:pause", () => {
      this.queueRunning = false
      this.broadcast()
      return this.workspace()
    })
    ipcMain.handle("wechat-miniprogram-drama:catalog-upload:task:cancel-active", async () => {
      if (!this.activeTaskId) throw new Error("当前没有正在执行的任务。")
      this.queueRunning = false
      this.abortController?.abort(abortError("用户已终止当前任务。"))
      this.broadcast()
      return this.workspace()
    })
    ipcMain.handle(
      "wechat-miniprogram-drama:catalog-upload:task:retry",
      (_event, id: string) => {
        this.repository.retry(id)
        this.startQueue()
        return this.workspace()
      },
    )
  }

  workspace(): WechatMiniProgramCatalogUploadWorkspace {
    return {
      queue: {
        running: this.queueRunning,
        activeTaskId: this.activeTaskId,
        currentPage: this.currentPage,
        totalPages: this.totalPages,
        error: this.queueError,
      },
      tasks: this.repository.list(),
      databasePath: this.repository.databasePath,
    }
  }

  isActive(): boolean {
    return this.queueRunning || Boolean(this.activeTaskId)
  }

  async stop(): Promise<void> {
    this.queueRunning = false
    this.abortController?.abort(abortError("应用正在退出，当前任务已中断。"))
    await this.workerPromise?.catch(() => undefined)
    this.window?.destroy()
    this.window = null
  }

  private startQueue(): void {
    const settings = this.options.getSettings()
    if (!settings.localEpisodeVideoRoot.trim()) {
      throw new Error("请先在微信小程序配置中设置剧集视频根目录。")
    }
    if (!settings.catalogAuthorizationToken.trim()) {
      throw new Error("请先在微信小程序配置中填写管理端访问令牌。")
    }
    if (this.queueRunning) return
    this.queueRunning = true
    this.queueError = undefined
    this.currentPage = 0
    this.totalPages = undefined
    this.broadcast()
    if (!this.workerPromise) {
      this.workerPromise = this.runQueue().finally(() => {
        this.workerPromise = null
        this.queueRunning = false
        this.activeTaskId = undefined
        this.broadcast()
      })
    }
  }

  private async runQueue(): Promise<void> {
    try {
      for (let page = 0; this.queueRunning; page += 1) {
        this.currentPage = page
        const result = await this.fetchDramaPage(page)
        this.totalPages = result.totalPages
        this.broadcast()

        for (const drama of result.items) {
          if (!this.queueRunning) break
          const targetEpisodeCount = Math.min(
            requestedEpisodeCount,
            Math.max(0, Math.floor(Number(drama.episodeCount) || 0)),
          )
          const task = this.repository.upsertDiscovered({
            dramaId: drama.id,
            wxDramaId: drama.wxDramaId ?? undefined,
            dramaName: drama.name,
            episodeCount: drama.episodeCount,
            baiduNetdiskUrl: drama.baiduNetdiskUrl?.trim() || undefined,
            targetEpisodeCount,
          })
          this.broadcast()
          if (task.state !== "discovered") continue
          if (targetEpisodeCount <= 0) {
            this.repository.update(task.id, {
              state: "failed",
              error: "剧列表中的总集数无效。",
              finishedAt: new Date().toISOString(),
            })
            this.broadcast()
            continue
          }
          await this.processTask(task)
        }

        if (page + 1 >= result.totalPages) break
      }
    } catch (error) {
      const message = readableError(error)
      if (!(error instanceof Error && error.name === "AbortError")) {
        this.queueError = message
        this.logger().error("Catalog upload queue stopped", { errorMessage: message })
      }
    }
  }

  private async processTask(task: WechatMiniProgramCatalogUploadTask): Promise<void> {
    const controller = new AbortController()
    this.abortController = controller
    this.activeTaskId = task.id
    const logger = this.logger(task)
    const targetEpisodeCount = task.targetEpisodeCount
    try {
      this.repository.update(task.id, {
        state: "downloading",
        error: undefined,
        startedAt: new Date().toISOString(),
        finishedAt: undefined,
      })
      this.broadcast()
      const settings = this.options.getSettings()
      const download = await ensureBaiduNetdiskShareDownloaded({
        requesterPlatform: "wechat-miniprogram-drama-catalog-upload",
        shareText: task.baiduNetdiskUrl ?? "",
        resourceName: task.dramaName,
        localEpisodeVideoRoot: settings.localEpisodeVideoRoot,
        episodeCount: targetEpisodeCount,
        episodeDownloadLimit: targetEpisodeCount,
        downloadEpisodeVideos: true,
        downloadAssetMaterials: false,
        requiredOwnership: { minimumImages: 0 },
        requiredOwnershipFiles: 0,
        requiredPosterImages: 0,
        requiredAiProductionProofFiles: 0,
        signal: controller.signal,
      })
      controller.signal.throwIfAborted()

      const { findLocalEpisodeVideos } = await import("@drama/drama-media-assets")
      const episodeVideos = (await findLocalEpisodeVideos({
        localEpisodeVideoRoot: settings.localEpisodeVideoRoot,
        resourceName: task.dramaName,
      })).filter((episode) => episode.index <= targetEpisodeCount)
      const expectedIndexes = Array.from({ length: targetEpisodeCount }, (_, index) => index + 1)
      const actualIndexes = episodeVideos.map((episode) => episode.index)
      if (
        actualIndexes.length !== expectedIndexes.length
        || actualIndexes.some((episode, index) => episode !== expectedIndexes[index])
      ) {
        throw new Error(
          `前${targetEpisodeCount}集下载校验失败：实际找到${actualIndexes.join("、") || "无"}。`,
        )
      }

      let statuses = await this.readExistingEpisodeStatuses(task, controller.signal)
      let uploadedEpisodeCount = statuses.filter(
        (status) => status.state === "uploaded" || status.state === "existing",
      ).length
      this.repository.update(task.id, {
        state: "uploading",
        localPath: download.localPath,
        episodeStatuses: statuses,
        uploadedEpisodeCount,
      })
      this.broadcast()

      for (const episode of episodeVideos) {
        controller.signal.throwIfAborted()
        const existing = statuses.find(
          (status) => status.episodeNo === episode.index && status.state === "existing",
        )
        if (existing) continue
        try {
          const uploaded = await this.uploadEpisode(
            task.dramaId,
            episode.index,
            episode.file,
            controller.signal,
          )
          statuses = statuses.filter((status) => status.episodeNo !== episode.index)
          statuses.push({
            episodeNo: episode.index,
            state: "uploaded",
            materialId: uploaded.materialId,
            fileName: uploaded.fileName ?? path.basename(episode.file),
          })
          statuses.sort((left, right) => left.episodeNo - right.episodeNo)
          uploadedEpisodeCount = statuses.filter(
            (status) => status.state === "uploaded" || status.state === "existing",
          ).length
          this.repository.update(task.id, {
            state: "uploading",
            episodeStatuses: statuses,
            uploadedEpisodeCount,
          })
          this.broadcast()
        } catch (error) {
          statuses = statuses.filter((status) => status.episodeNo !== episode.index)
          statuses.push({
            episodeNo: episode.index,
            state: "failed",
            fileName: path.basename(episode.file),
            error: readableError(error),
          })
          this.repository.update(task.id, { episodeStatuses: statuses })
          throw error
        }
      }

      this.repository.update(task.id, {
        state: "completed",
        uploadedEpisodeCount: targetEpisodeCount,
        episodeStatuses: statuses,
        error: undefined,
        finishedAt: new Date().toISOString(),
      })
      logger.info("First episodes uploaded to drama materials", {
        dramaId: task.dramaId,
        episodeCount: targetEpisodeCount,
      })
    } catch (error) {
      const interrupted = controller.signal.aborted
        || (error instanceof Error && error.name === "AbortError")
      const message = readableError(error)
      this.repository.update(task.id, {
        state: interrupted ? "interrupted" : "failed",
        error: message,
        finishedAt: new Date().toISOString(),
      })
      if (interrupted) logger.warn("Catalog upload task interrupted", { errorMessage: message })
      else logger.error("Catalog upload task failed", { errorMessage: message })
    } finally {
      if (this.abortController === controller) this.abortController = null
      if (this.activeTaskId === task.id) this.activeTaskId = undefined
      this.broadcast()
    }
  }

  private async fetchDramaPage(page: number): Promise<DramaPage> {
    const settings = this.options.getSettings()
    const url = apiUrl(settings.catalogApiBaseUrl, "/admin/v1/dramas")
    url.searchParams.set("page", String(page))
    url.searchParams.set("size", String(pageSize))
    const response = await fetch(url, {
      headers: {
        accept: "application/json, text/plain, */*",
        authorization: authorizationValue(settings.catalogAuthorizationToken),
        "x-operator": "",
      },
    })
    return this.readApiResponse<DramaPage>(response, "读取剧列表失败")
  }

  private async readExistingEpisodeStatuses(
    task: WechatMiniProgramCatalogUploadTask,
    signal: AbortSignal,
  ): Promise<WechatMiniProgramCatalogEpisodeStatus[]> {
    const settings = this.options.getSettings()
    const url = apiUrl(
      settings.materialUploadApiBaseUrl,
      `/admin/v1/dramas/${task.dramaId}/materials`,
    )
    url.searchParams.set("materialType", "EPISODE_VIDEO")
    const response = await fetch(url, {
      signal,
      headers: {
        accept: "application/json",
        authorization: authorizationValue(settings.catalogAuthorizationToken),
      },
    })
    const materials = await this.readApiResponse<MaterialView[]>(response, "读取已上传素材失败")
    const statuses = materials
      .filter((material) => Number.isInteger(material.episodeNo)
        && Number(material.episodeNo) >= 1
        && Number(material.episodeNo) <= task.targetEpisodeCount)
      .map((material) => ({
        episodeNo: Number(material.episodeNo),
        state: "existing" as const,
        materialId: material.materialId,
        fileName: material.fileName,
      }))
      .sort((left, right) => left.episodeNo - right.episodeNo)
    return [...new Map(statuses.map((status) => [status.episodeNo, status])).values()]
  }

  private async uploadEpisode(
    dramaId: number,
    episodeNo: number,
    file: string,
    signal: AbortSignal,
  ): Promise<MaterialView> {
    const settings = this.options.getSettings()
    const url = apiUrl(
      settings.materialUploadApiBaseUrl,
      `/admin/v1/dramas/${dramaId}/materials`,
    )
    url.searchParams.set("materialType", "EPISODE_VIDEO")
    url.searchParams.set("episodeNo", String(episodeNo))
    const form = new FormData()
    form.append("file", await openAsBlob(file, { type: videoContentType(file) }), path.basename(file))
    const response = await fetch(url, {
      method: "POST",
      signal,
      headers: { authorization: authorizationValue(settings.catalogAuthorizationToken) },
      body: form,
    })
    return this.readApiResponse<MaterialView>(response, `第${episodeNo}集上传失败`)
  }

  private async readApiResponse<T>(response: Response, action: string): Promise<T> {
    const text = await response.text()
    let payload: ApiResponse<T> | undefined
    try {
      payload = JSON.parse(text) as ApiResponse<T>
    } catch {
      throw new Error(`${action}：HTTP ${response.status}，接口未返回 JSON。`)
    }
    if (!response.ok || payload.code !== 0) {
      throw new Error(`${action}：${payload.message || `HTTP ${response.status}`}`)
    }
    return payload.data
  }

  private openWindow(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show()
      this.window.focus()
      return
    }
    const window = new BrowserWindow({
      width: 1040,
      height: 720,
      minWidth: 900,
      minHeight: 600,
      show: false,
      title: "微信小程序 · 前四集入库",
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
      url.searchParams.set("window", windowMode)
      void window.loadURL(url.toString())
    } else {
      void window.loadFile(
        path.join(process.env.APP_ROOT ?? path.join(__dirname, "..", ".."), "dist", "index.html"),
        { query: { window: windowMode } },
      )
    }
  }

  private broadcast(): void {
    const workspace = this.workspace()
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(
        "wechat-miniprogram-drama:catalog-upload:workspace:changed",
        workspace,
      )
    }
  }

  private logger(task?: WechatMiniProgramCatalogUploadTask) {
    const settings = this.options.getSettings()
    return createElectronPlatformLogger({
      platform: "wechat-miniprogram-drama",
      scope: "catalog-first-episodes",
      context: task ? { taskId: task.id, dramaId: task.dramaId, dramaName: task.dramaName } : undefined,
      logDir: path.join(resolveFromAppRoot(settings.runDataDir), "logs"),
      retentionDays: Number.parseInt(settings.logRetentionDays ?? "3", 10) || 3,
    })
  }
}
