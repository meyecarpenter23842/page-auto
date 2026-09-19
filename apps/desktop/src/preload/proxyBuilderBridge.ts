import { contextBridge, ipcRenderer } from 'electron'
import {
  PROXY_BUILDER_IPC,
  type ProxyBuilderAuditInput,
  type ProxyBuilderAuditResult,
  type ProxyBuilderCheckerSnapshot,
  type ProxyBuilderCheckerStartInput,
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
  startChecker: (input: ProxyBuilderCheckerStartInput) => Promise<ProxyBuilderCheckerSnapshot>
  getCheckerStatus: (runId: string) => Promise<ProxyBuilderCheckerSnapshot | null>
  cancelChecker: (runId: string) => Promise<ProxyBuilderCheckerSnapshot | null>
}

const api: ProxyBuilderPreloadApi = {
  auditVps: (input) => ipcRenderer.invoke(PROXY_BUILDER_IPC.auditVps, input),
  startProvision: (input) => ipcRenderer.invoke(PROXY_BUILDER_IPC.provisionStart, input),
  getProvisionStatus: (runId) => ipcRenderer.invoke(PROXY_BUILDER_IPC.provisionStatus, { runId }),
  cancelProvision: (runId) => ipcRenderer.invoke(PROXY_BUILDER_IPC.provisionCancel, { runId }),
  controlRuntime: (input) => ipcRenderer.invoke(PROXY_BUILDER_IPC.runtimeControl, input),
  startChecker: (input) => ipcRenderer.invoke(PROXY_BUILDER_IPC.checkerStart, input),
  getCheckerStatus: (runId) => ipcRenderer.invoke(PROXY_BUILDER_IPC.checkerStatus, { runId }),
  cancelChecker: (runId) => ipcRenderer.invoke(PROXY_BUILDER_IPC.checkerCancel, { runId })
}

contextBridge.exposeInMainWorld('pageAutoProxyBuilder', api)
