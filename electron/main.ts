import { app, BrowserWindow, Menu, nativeImage } from 'electron'
import windowStateKeeper from 'electron-window-state'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import {
  registerWechatVideoPlatformHandlers,
  stopWechatVideoPlatformRuntime,
} from './platforms/wechat-video'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

function getAppIconPath() {
  return path.join(process.env.VITE_PUBLIC, 'icon.png')
}

function createWindow() {
  const appIcon = nativeImage.createFromPath(getAppIconPath())
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1280,
    defaultHeight: 860,
  })

  win = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 1024,
    minHeight: 720,
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })
  mainWindowState.manage(win)
  win.setMenu(null)

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('before-quit', () => {
  stopWechatVideoPlatformRuntime()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  registerWechatVideoPlatformHandlers()

  if (process.platform === 'darwin' && VITE_DEV_SERVER_URL) {
    app.dock?.setIcon(getAppIconPath())
  }

  createWindow()
})
