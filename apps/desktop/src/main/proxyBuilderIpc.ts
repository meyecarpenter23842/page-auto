import { ipcMain } from 'electron'
import {
  PROXY_BUILDER_IPC,
  type ProxyBuilderAuditInput,
  type ProxyBuilderProvisionInput,
  type ProxyBuilderRunIdPayload,
  type ProxyBuilderRuntimeControlInput
} from '../shared/proxyBuilder'
import { ProxyBuilderProvisionService } from './proxyBuilder/provisionService'
import { auditProxyBuilderVps } from './proxyBuilder/sshDiscoveryService'

export interface ProxyBuilderIpcRuntime { dispose: () => void }

export function registerProxyBuilderIpc(): ProxyBuilderIpcRuntime {
  const provision = new ProxyBuilderProvisionService()
  for (const channel of Object.values(PROXY_BUILDER_IPC)) ipcMain.removeHandler(channel)

  ipcMain.handle(PROXY_BUILDER_IPC.auditVps, (_event, input: ProxyBuilderAuditInput) => auditProxyBuilderVps(input))
  ipcMain.handle(PROXY_BUILDER_IPC.provisionStart, (_event, input: ProxyBuilderProvisionInput) => provision.start(input))
  ipcMain.handle(PROXY_BUILDER_IPC.provisionStatus, (_event, payload: ProxyBuilderRunIdPayload) => provision.status(payload))
  ipcMain.handle(PROXY_BUILDER_IPC.provisionCancel, (_event, payload: ProxyBuilderRunIdPayload) => provision.cancel(payload))
  ipcMain.handle(PROXY_BUILDER_IPC.runtimeControl, (_event, input: ProxyBuilderRuntimeControlInput) => provision.controlRuntime(input))

  return {
    dispose: () => {
      provision.dispose()
      for (const channel of Object.values(PROXY_BUILDER_IPC)) ipcMain.removeHandler(channel)
    }
  }
}
