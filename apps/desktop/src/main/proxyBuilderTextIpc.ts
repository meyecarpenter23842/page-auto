import { clipboard, dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import {
  PROXY_BUILDER_TEXT_IPC,
  type ProxyBuilderExportTextPayload,
  type ProxyBuilderExportTextResult,
  type ProxyBuilderTextPayload
} from '../shared/proxyBuilderText'

const MAX_TEXT_BYTES = 5 * 1024 * 1024

function validateText(text: string): void {
  if (!text.trim()) throw new Error('Không có dữ liệu để xuất.')
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) throw new Error('Dữ liệu xuất vượt quá 5 MB.')
}

export interface ProxyBuilderTextIpcRuntime { dispose: () => void }

export function registerProxyBuilderTextIpc(): ProxyBuilderTextIpcRuntime {
  for (const channel of Object.values(PROXY_BUILDER_TEXT_IPC)) ipcMain.removeHandler(channel)

  ipcMain.handle(PROXY_BUILDER_TEXT_IPC.copy, (_event, payload: ProxyBuilderTextPayload) => {
    validateText(payload.text)
    clipboard.writeText(payload.text)
    return true
  })

  ipcMain.handle(PROXY_BUILDER_TEXT_IPC.export, async (_event, payload: ProxyBuilderExportTextPayload): Promise<ProxyBuilderExportTextResult> => {
    validateText(payload.text)
    const suggestedName = payload.suggestedName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'proxies.txt'
    const result = await dialog.showSaveDialog({
      title: 'Xuất danh sách Proxy',
      defaultPath: suggestedName.endsWith('.txt') ? suggestedName : `${suggestedName}.txt`,
      filters: [{ name: 'Text', extensions: ['txt'] }]
    })
    if (result.canceled || !result.filePath) return { cancelled: true, filePath: null }
    await writeFile(result.filePath, payload.text, 'utf8')
    return { cancelled: false, filePath: result.filePath }
  })

  return {
    dispose: () => {
      for (const channel of Object.values(PROXY_BUILDER_TEXT_IPC)) ipcMain.removeHandler(channel)
    }
  }
}
