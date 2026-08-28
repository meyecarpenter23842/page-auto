import { existsSync } from 'node:fs'
import { dialog, ipcMain, shell } from 'electron'
import type Database from 'better-sqlite3'
import {
  CHECKPOINT282_WORKBENCH_IPC,
  type FacebookCheckpoint282AssetPreviewRequest,
  type FacebookCheckpoint282HistoryRequest,
  type FacebookCheckpoint282PreflightRequest,
  type FacebookCheckpoint282Preset,
  type FacebookCheckpoint282ResolveDuplicateRequest
} from '../shared/checkpoint282Workbench'
import { Checkpoint282WorkbenchService } from './services/checkpoint282WorkbenchService'

interface RegisterCheckpoint282WorkbenchIpcOptions {
  database: Database.Database
  dataDirectory: string
}

export interface Checkpoint282WorkbenchIpcRuntime {
  dispose: () => void
}

export function registerCheckpoint282WorkbenchIpcHandlers(
  options: RegisterCheckpoint282WorkbenchIpcOptions
): Checkpoint282WorkbenchIpcRuntime {
  const service = new Checkpoint282WorkbenchService(options.database, options.dataDirectory)

  ipcMain.handle(CHECKPOINT282_WORKBENCH_IPC.getPreset, () => service.getPreset())
  ipcMain.handle(CHECKPOINT282_WORKBENCH_IPC.savePreset, (_event, input: FacebookCheckpoint282Preset) => service.savePreset(input))
  ipcMain.handle(CHECKPOINT282_WORKBENCH_IPC.preflight, (_event, input: FacebookCheckpoint282PreflightRequest) => service.preflight(input))
  ipcMain.handle(CHECKPOINT282_WORKBENCH_IPC.previewAsset, (_event, input: FacebookCheckpoint282AssetPreviewRequest) => service.previewAsset(input))
  ipcMain.handle(CHECKPOINT282_WORKBENCH_IPC.resolveDuplicate, (_event, input: FacebookCheckpoint282ResolveDuplicateRequest) => service.resolveDuplicate(input))
  ipcMain.handle(CHECKPOINT282_WORKBENCH_IPC.history, (_event, input: FacebookCheckpoint282HistoryRequest) => service.history(input))
  ipcMain.handle(CHECKPOINT282_WORKBENCH_IPC.pickSourceFolder, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Chọn Folder ảnh nguồn CP282',
      properties: ['openDirectory']
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(CHECKPOINT282_WORKBENCH_IPC.revealPath, (_event, path: string) => {
    const normalized = path?.trim()
    if (!normalized || !existsSync(normalized)) return false
    shell.showItemInFolder(normalized)
    return true
  })

  return {
    dispose: () => {
      ipcMain.removeHandler(CHECKPOINT282_WORKBENCH_IPC.getPreset)
      ipcMain.removeHandler(CHECKPOINT282_WORKBENCH_IPC.savePreset)
      ipcMain.removeHandler(CHECKPOINT282_WORKBENCH_IPC.preflight)
      ipcMain.removeHandler(CHECKPOINT282_WORKBENCH_IPC.previewAsset)
      ipcMain.removeHandler(CHECKPOINT282_WORKBENCH_IPC.resolveDuplicate)
      ipcMain.removeHandler(CHECKPOINT282_WORKBENCH_IPC.history)
      ipcMain.removeHandler(CHECKPOINT282_WORKBENCH_IPC.pickSourceFolder)
      ipcMain.removeHandler(CHECKPOINT282_WORKBENCH_IPC.revealPath)
    }
  }
}
