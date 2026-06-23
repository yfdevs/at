import { ipcRenderer, contextBridge } from 'electron'

type IpcRendererListener = Parameters<typeof ipcRenderer.on>[1]

const listenerMap = new Map<string, WeakMap<IpcRendererListener, IpcRendererListener>>()

function getListenerMap(channel: string) {
  let channelListeners = listenerMap.get(channel)

  if (!channelListeners) {
    channelListeners = new WeakMap()
    listenerMap.set(channel, channelListeners)
  }

  return channelListeners
}

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    const wrappedListener: IpcRendererListener = (event, ...args) => listener(event, ...args)
    getListenerMap(channel).set(listener, wrappedListener)
    return ipcRenderer.on(channel, wrappedListener)
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, listener] = args
    const channelListeners = getListenerMap(channel)
    const wrappedListener = channelListeners.get(listener) ?? listener
    channelListeners.delete(listener)
    return ipcRenderer.off(channel, wrappedListener)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})
