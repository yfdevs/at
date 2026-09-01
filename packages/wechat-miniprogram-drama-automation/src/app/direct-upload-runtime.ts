import path from "node:path"
import { mkdir } from "node:fs/promises"
import { chromium, type BrowserContext, type Page } from "playwright"

import { loginQrCodeSelector, playletUrl } from "../automation/constants.js"
import {
  isWechatMiniProgramLoginUrl,
  waitForLoginIfNeeded,
} from "../automation/browser-session.js"
import { uploadEpisodeVideosOnly } from "../automation/steps/episodes.js"
import { createLogger } from "../shared/logger.js"
import {
  configureWechatMiniProgramRuntimeSettings,
  type WechatMiniProgramRuntimeSettings,
} from "../shared/runtime-settings.js"
import type { PreparedEpisodeVideo } from "../shared/types.js"

const logger = createLogger("direct-upload")

export type WechatMiniProgramDirectUploadBrowserStatus = {
  launched: boolean
  loginState: "not-launched" | "login-required" | "logged-in" | "unknown"
  activeUrl?: string
}

export type WechatMiniProgramDirectUploadRuntime = {
  getStatus: () => WechatMiniProgramDirectUploadBrowserStatus
  refreshStatus: () => Promise<WechatMiniProgramDirectUploadBrowserStatus>
  focusBrowser: () => Promise<void>
  upload: (input: {
    resourceName: string
    dramaName: string
    episodeCount: number
    episodeVideos: PreparedEpisodeVideo[]
    onAuthenticated?: () => void
    onProgress?: (progress: { completed: number; total: number }) => void
  }) => Promise<void>
  closeBrowser: () => Promise<void>
  stop: () => Promise<void>
}

export type WechatMiniProgramDirectUploadRuntimeOptions = {
  userDataDir: string
  settings: Partial<WechatMiniProgramRuntimeSettings>
}

async function detectLoginState(
  page: Page,
): Promise<WechatMiniProgramDirectUploadBrowserStatus["loginState"]> {
  const activeUrl = page.url()
  if (!activeUrl || activeUrl === "about:blank") return "unknown"
  if (isWechatMiniProgramLoginUrl(activeUrl)) return "login-required"

  const loginQrCodeVisible = await page.locator(loginQrCodeSelector)
    .first()
    .isVisible()
    .catch(() => false)
  if (loginQrCodeVisible) return "login-required"

  try {
    const url = new URL(activeUrl)
    if (url.hostname === "mp.weixin.qq.com") {
      const bodyReady = await page.locator("body").isVisible().catch(() => false)
      return bodyReady ? "logged-in" : "unknown"
    }
  } catch {
    return "unknown"
  }
  return "unknown"
}

function activePage(context: BrowserContext): Page | undefined {
  const pages = context.pages().filter((page) => !page.isClosed())
  return pages.find((page) => page.url() !== "about:blank") ?? pages[0]
}

export function startWechatMiniProgramDirectUploadRuntime(
  options: WechatMiniProgramDirectUploadRuntimeOptions,
): WechatMiniProgramDirectUploadRuntime {
  configureWechatMiniProgramRuntimeSettings(options.settings)
  let context: BrowserContext | null = null
  let launchPromise: Promise<BrowserContext> | null = null
  let selectedPage: Page | null = null
  let loginState: WechatMiniProgramDirectUploadBrowserStatus["loginState"] = "unknown"

  const refreshPageStatus = async (page: Page) => {
    if (page.isClosed()) return
    selectedPage = page
    loginState = await detectLoginState(page)
  }

  const bindPage = (page: Page) => {
    selectedPage = page
    page.on("domcontentloaded", () => {
      void refreshPageStatus(page)
    })
    page.on("close", () => {
      if (selectedPage === page) selectedPage = null
    })
    void refreshPageStatus(page)
  }

  const currentPage = () => {
    if (selectedPage && !selectedPage.isClosed()) return selectedPage
    return context ? activePage(context) : undefined
  }

  const getOrLaunch = async () => {
    if (context) return context
    if (launchPromise) return launchPromise

    launchPromise = (async () => {
      const userDataDir = path.resolve(options.userDataDir)
      await mkdir(userDataDir, { recursive: true })
      logger.info("正在启动百度资源直传浏览器", { userDataDir })
      const launched = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        slowMo: 20,
        viewport: { width: 1440, height: 900 },
        acceptDownloads: true,
        ignoreDefaultArgs: ["--enable-automation"],
      })
      launched.once("close", () => {
        if (context === launched) {
          context = null
          selectedPage = null
          loginState = "unknown"
        }
      })
      for (const page of launched.pages()) bindPage(page)
      launched.on("page", bindPage)
      context = launched
      return launched
    })().finally(() => {
      launchPromise = null
    })

    return launchPromise
  }

  const getPage = async () => {
    const browserContext = await getOrLaunch()
    const page = currentPage() ?? await browserContext.newPage()
    selectedPage = page
    return page
  }

  const ensureLoggedIn = async (page: Page) => {
    await page.goto(playletUrl, { waitUntil: "domcontentloaded" })
    await page.evaluate(() => {
      document.title = "微信小程序 · 百度资源直传"
    }).catch(() => undefined)
    await waitForLoginIfNeeded(page, "百度资源直传")
    await refreshPageStatus(page)
    if (loginState !== "logged-in") {
      throw new Error("微信小程序账号尚未完成登录。")
    }
    logger.info("百度资源直传浏览器已登录")
  }

  const closeBrowser = async () => {
    const current = context ?? await launchPromise?.catch(() => null)
    context = null
    if (current) await current.close().catch(() => undefined)
  }

  return {
    getStatus() {
      const page = currentPage()
      const activeUrl = page?.url()
      return {
        launched: Boolean(context),
        loginState: context ? loginState : "not-launched",
        activeUrl: activeUrl && activeUrl !== "about:blank" ? activeUrl : undefined,
      }
    },
    async refreshStatus() {
      const page = currentPage()
      if (page) await refreshPageStatus(page)
      return this.getStatus()
    },
    async focusBrowser() {
      const page = await getPage()
      if (page.url() === "about:blank") {
        await page.goto(playletUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined)
      }
      await page.bringToFront()
      await page.evaluate(() => window.focus()).catch(() => undefined)
      await refreshPageStatus(page)
    },
    async upload(input) {
      const page = await getPage()
      await ensureLoggedIn(page)
      input.onAuthenticated?.()
      await uploadEpisodeVideosOnly(page, {
        resourceName: input.resourceName,
        uploadBaseName: input.dramaName,
        episodeCount: input.episodeCount,
        episodeVideos: input.episodeVideos,
        videoAccountLabel: "百度资源直传当前登录账号",
        onProgress: input.onProgress,
      })
    },
    closeBrowser,
    stop: closeBrowser,
  }
}
