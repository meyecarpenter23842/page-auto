import { contextBridge, ipcRenderer } from 'electron'
import {
  PROXY_BUILDER_IPC,
  type ProxyBuilderAuditInput,
  type ProxyBuilderAuditResult
} from '../shared/proxyBuilder'

export interface ProxyBuilderPreloadApi {
  auditVps: (input: ProxyBuilderAuditInput) => Promise<ProxyBuilderAuditResult>
}

const api: ProxyBuilderPreloadApi = {
  auditVps: (input) => ipcRenderer.invoke(PROXY_BUILDER_IPC.auditVps, input)
}

contextBridge.exposeInMainWorld('pageAutoProxyBuilder', api)
