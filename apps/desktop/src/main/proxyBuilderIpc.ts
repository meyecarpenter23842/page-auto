import { dialog, ipcMain } from 'electron'
import { basename } from 'node:path'
import {
  PROXY_BUILDER_IPC,
  type ProxyBuilderAuditInput,
  type ProxyBuilderCheckerStartInput,
  type ProxyBuilderProvisionInput,
  type ProxyBuilderRunIdPayload,
  type ProxyBuilderRuntimeControlInput
} from '../shared/proxyBuilder'
import { ProxyBuilderCheckerService } from './proxyBuilder/checkerService'
import { ProxyBuilderProvisionService } from './proxyBuilder/provisionService'
import { auditProxyBuilderVps } from './proxyBuilder/sshDiscoveryService'

export interface ProxyBuilderIpcRuntime { dispose: () => void }

export function registerProxyBuilderIpc(): ProxyBuilderIpcRuntime {
  const provision = new ProxyBuilderProvisionService()
  const checker = new ProxyBuilderCheckerService()
  for (const channel of Object.values(PROXY_BUILDER_IPC)) ipcMain.removeHandler(channel)

  ipcMain.handle(PROXY_BUILDER_IPC.pickPrivateKey, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Chọn SSH Private Key',
      properties: ['openFile']
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return { cancelled: true }
    return { cancelled: false, path, fileName: basename(path) }
  })
  ipcMain.handle(PROXY_BUILDER_IPC.auditVps, (_event, input: ProxyBuilderAuditInput) => auditProxyBuilderVps(input))
  ipcMain.handle(PROXY_BUILDER_IPC.provisionStart, (_event, input: ProxyBuilderProvisionInput) => provision.start(input))
  ipcMain.handle(PROXY_BUILDER_IPC.provisionStatus, (_event, payload: ProxyBuilderRunIdPayload) => provision.status(payload))
  ipcMain.handle(PROXY_BUILDER_IPC.provisionCancel, (_event, payload: ProxyBuilderRunIdPayload) => provision.cancel(payload))
  ipcMain.handle(PROXY_BUILDER_IPC.runtimeControl, (_event, input: ProxyBuilderRuntimeControlInput) => provision.controlRuntime(input))
  ipcMain.handle(PROXY_BUILDER_IPC.checkerStart, (_event, input: ProxyBuilderCheckerStartInput) => checker.start(input))
  ipcMain.handle(PROXY_BUILDER_IPC.checkerStatus, (_event, payload: ProxyBuilderRunIdPayload) => checker.status(payload))
  ipcMain.handle(PROXY_BUILDER_IPC.checkerCancel, (_event, payload: ProxyBuilderRunIdPayload) => checker.cancel(payload))

  return {
    dispose: () => {
      checker.dispose()
      provision.dispose()
      for (const channel of Object.values(PROXY_BUILDER_IPC)) ipcMain.removeHandler(channel)
    }
  }
}
