import { contextBridge, ipcRenderer } from 'electron'
import {
  PROXY_BUILDER_TEXT_IPC,
  type ProxyBuilderExportTextResult
} from '../shared/proxyBuilderText'

export interface ProxyBuilderTextPreloadApi {
  copy: (text: string) => Promise<boolean>
  export: (text: string, suggestedName: string) => Promise<ProxyBuilderExportTextResult>
}

const api: ProxyBuilderTextPreloadApi = {
  copy: (text) => ipcRenderer.invoke(PROXY_BUILDER_TEXT_IPC.copy, { text }),
  export: (text, suggestedName) => ipcRenderer.invoke(PROXY_BUILDER_TEXT_IPC.export, { text, suggestedName })
}

contextBridge.exposeInMainWorld('pageAutoProxyBuilderText', api)
