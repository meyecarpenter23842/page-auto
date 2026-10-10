import { dialog, ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import {
  COPY_POST_IPC,
  type CopyPostSaveRequest,
  type CopyPostScanRequest
} from '../shared/copyPost'
import { CopyPostService } from './services/copyPostService'

export interface CopyPostIpcRuntime { dispose: () => void }

export function registerCopyPostIpcHandlers(database: Database.Database): CopyPostIpcRuntime {
  const service = new CopyPostService(database)

  ipcMain.handle(COPY_POST_IPC.scan, (_event, input: CopyPostScanRequest) => service.scan(input))
  ipcMain.handle(COPY_POST_IPC.pickMediaFolder, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Chọn thư mục lưu ảnh / video đã copy',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(COPY_POST_IPC.saveSelected, (_event, input: CopyPostSaveRequest) => service.saveSelected(input))

  return {
    dispose: () => {
      for (const channel of Object.values(COPY_POST_IPC)) ipcMain.removeHandler(channel)
    }
  }
}
