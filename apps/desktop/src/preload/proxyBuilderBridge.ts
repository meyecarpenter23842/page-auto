import { contextBridge, ipcRenderer } from 'electron'
import {
  PROXY_BUILDER_IPC,
  type ProxyBuilderAuditInput,
  type ProxyBuilderAuditResult,
  type ProxyBuilderProvisionInput,
  type ProxyBuilderProvisionSnapshot,
  type ProxyBuilderRuntimeControlInput,
  type ProxyBuilderRuntimeControlResult
} from '../shared/proxyBuilder'

export interface ProxyBuilderPreloadApi {
  auditVps: (input: ProxyBuilderAuditInput) => Promise<ProxyBuilderAuditResult>
  startProvision: (input: ProxyBuilderProvisionInput) => Promise<ProxyBuilderProvisionSnapshot>
  getProvisionStatus: (runId: string) => Promise<ProxyBuilderProvisionSnapshot | null>
  cancelProvision: (runId: string) => Promise<ProxyBuilderProvisionSnapshot | null>
  controlRuntime: (input: ProxyBuilderRuntimeControlInput) => Promise<ProxyBuilderRuntimeControlResult>
}

const api: ProxyBuilderPreloadApi = {
  auditVps: (input) => ipcRenderer.invoke(PROXY_BUILDER_IPC.auditVps, input),
  startProvision: (input) => ipcRenderer.invoke(PROXY_BUILDER_IPC.provisionStart, input),
  getProvisionStatus: (runId) => ipcRenderer.invoke(PROXY_BUILDER_IPC.provisionStatus, { runId }),
  cancelProvision: (runId) => ipcRenderer.invoke(PROXY_BUILDER_IPC.provisionCancel, { runId }),
  controlRuntime: (input) => ipcRenderer.invoke(PROXY_BUILDER_IPC.runtimeControl, input)
}

contextBridge.exposeInMainWorld('pageAutoProxyBuilder', api)
