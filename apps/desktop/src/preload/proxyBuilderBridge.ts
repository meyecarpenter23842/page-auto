import { contextBridge, ipcRenderer } from 'electron'
import {
  PROXY_BUILDER_IPC,
  type ProxyBuilderAuditInput,
  type ProxyBuilderAuditResult,
  type ProxyBuilderCheckerSnapshot,
  type ProxyBuilderCheckerStartInput,
  type ProxyBuilderPrivateKeyPickResult,
  type ProxyBuilderOciConfigPickResult,
  type ProxyBuilderProvisionInput,
  type ProxyBuilderProvisionSnapshot,
  type ProxyBuilderRuntimeControlInput,
  type ProxyBuilderRuntimeControlResult,
  type ProxyCenterAccountBinding,
  type ProxyCenterAccountIdsInput,
  type ProxyCenterAssignInput,
  type ProxyCenterInventoryDeleteInput,
  type ProxyCenterInventoryRecord,
  type ProxyCenterInventoryUpsertInput,
  type ProxyCenterInventoryUpsertResult
} from '../shared/proxyBuilder'

export interface ProxyBuilderPreloadApi {
  pickPrivateKey: () => Promise<ProxyBuilderPrivateKeyPickResult>
  pickOciConfig: () => Promise<ProxyBuilderOciConfigPickResult>
  auditVps: (input: ProxyBuilderAuditInput) => Promise<ProxyBuilderAuditResult>
  startProvision: (input: ProxyBuilderProvisionInput) => Promise<ProxyBuilderProvisionSnapshot>
  getProvisionStatus: (runId: string) => Promise<ProxyBuilderProvisionSnapshot | null>
  cancelProvision: (runId: string) => Promise<ProxyBuilderProvisionSnapshot | null>
  controlRuntime: (input: ProxyBuilderRuntimeControlInput) => Promise<ProxyBuilderRuntimeControlResult>
  startChecker: (input: ProxyBuilderCheckerStartInput) => Promise<ProxyBuilderCheckerSnapshot>
  getCheckerStatus: (runId: string) => Promise<ProxyBuilderCheckerSnapshot | null>
  cancelChecker: (runId: string) => Promise<ProxyBuilderCheckerSnapshot | null>
  listInventory: () => Promise<ProxyCenterInventoryRecord[]>
  upsertInventory: (input: ProxyCenterInventoryUpsertInput) => Promise<ProxyCenterInventoryUpsertResult>
  checkInventory: (input: ProxyCenterInventoryDeleteInput) => Promise<ProxyCenterInventoryRecord[]>
  deleteInventory: (input: ProxyCenterInventoryDeleteInput) => Promise<number>
  listAccountBindings: () => Promise<ProxyCenterAccountBinding[]>
  assignInventoryProxy: (input: ProxyCenterAssignInput) => Promise<ProxyCenterAccountBinding[]>
  clearAccountProxy: (input: ProxyCenterAccountIdsInput) => Promise<ProxyCenterAccountBinding[]>
}

const api: ProxyBuilderPreloadApi = {
  pickPrivateKey: () => ipcRenderer.invoke(PROXY_BUILDER_IPC.pickPrivateKey),
  pickOciConfig: () => ipcRenderer.invoke(PROXY_BUILDER_IPC.pickOciConfig),
  auditVps: (input) => ipcRenderer.invoke(PROXY_BUILDER_IPC.auditVps, input),
  startProvision: (input) => ipcRenderer.invoke(PROXY_BUILDER_IPC.provisionStart, input),
  getProvisionStatus: (runId) => ipcRenderer.invoke(PROXY_BUILDER_IPC.provisionStatus, { runId }),
  cancelProvision: (runId) => ipcRenderer.invoke(PROXY_BUILDER_IPC.provisionCancel, { runId }),
  controlRuntime: (input) => ipcRenderer.invoke(PROXY_BUILDER_IPC.runtimeControl, input),
  startChecker: (input) => ipcRenderer.invoke(PROXY_BUILDER_IPC.checkerStart, input),
  getCheckerStatus: (runId) => ipcRenderer.invoke(PROXY_BUILDER_IPC.checkerStatus, { runId }),
  cancelChecker: (runId) => ipcRenderer.invoke(PROXY_BUILDER_IPC.checkerCancel, { runId }),
  listInventory: () => ipcRenderer.invoke(PROXY_BUILDER_IPC.inventoryList),
  upsertInventory: (input) => ipcRenderer.invoke(PROXY_BUILDER_IPC.inventoryUpsert, input),
  checkInventory: (input) => ipcRenderer.invoke(PROXY_BUILDER_IPC.inventoryCheck, input),
  deleteInventory: (input) => ipcRenderer.invoke(PROXY_BUILDER_IPC.inventoryDelete, input),
  listAccountBindings: () => ipcRenderer.invoke(PROXY_BUILDER_IPC.accountBindingsList),
  assignInventoryProxy: (input) => ipcRenderer.invoke(PROXY_BUILDER_IPC.accountBindingsAssign, input),
  clearAccountProxy: (input) => ipcRenderer.invoke(PROXY_BUILDER_IPC.accountBindingsClear, input)
}

contextBridge.exposeInMainWorld('pageAutoProxyBuilder', api)
