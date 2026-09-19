import { ipcMain } from 'electron'
import { PROXY_BUILDER_IPC, type ProxyBuilderAuditInput } from '../shared/proxyBuilder'
import { auditProxyBuilderVps } from './proxyBuilder/sshDiscoveryService'

export interface ProxyBuilderIpcRuntime { dispose: () => void }

export function registerProxyBuilderIpc(): ProxyBuilderIpcRuntime {
  ipcMain.removeHandler(PROXY_BUILDER_IPC.auditVps)
  ipcMain.handle(PROXY_BUILDER_IPC.auditVps, (_event, input: ProxyBuilderAuditInput) => auditProxyBuilderVps(input))
  return {
    dispose: () => {
      ipcMain.removeHandler(PROXY_BUILDER_IPC.auditVps)
    }
  }
}
