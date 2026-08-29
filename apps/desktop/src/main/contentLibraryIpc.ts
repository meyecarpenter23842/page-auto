import { dialog, ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import { readFile, stat } from 'node:fs/promises'
import {
  CONTENT_LIBRARY_IPC,
  type ContentLibraryItemIdPayload,
  type ContentLibrarySetIdPayload,
  type CreateContentLibraryItemInput,
  type CreateContentLibrarySetInput,
  type MoveContentLibraryItemInput,
  type RenameContentLibrarySetInput,
  type UpdateContentLibraryItemInput
} from '../shared/contentLibrary'
import { ContentLibraryRepository } from './database/contentLibraryRepository'

export interface ContentLibraryIpcRuntime {
  dispose: () => void
}

const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024

export function registerContentLibraryIpcHandlers(database: Database.Database): ContentLibraryIpcRuntime {
  const library = new ContentLibraryRepository(database)

  ipcMain.handle(CONTENT_LIBRARY_IPC.list, () => library.list())
  ipcMain.handle(CONTENT_LIBRARY_IPC.get, (_event, payload: ContentLibrarySetIdPayload) => library.get(payload.id))
  ipcMain.handle(CONTENT_LIBRARY_IPC.createSet, (_event, input: CreateContentLibrarySetInput) => library.createSet(input))
  ipcMain.handle(CONTENT_LIBRARY_IPC.renameSet, (_event, input: RenameContentLibrarySetInput) => library.renameSet(input))
  ipcMain.handle(CONTENT_LIBRARY_IPC.deleteSet, (_event, payload: ContentLibrarySetIdPayload) => library.deleteSet(payload.id))
  ipcMain.handle(CONTENT_LIBRARY_IPC.createItem, (_event, input: CreateContentLibraryItemInput) => library.createItem(input))
  ipcMain.handle(CONTENT_LIBRARY_IPC.updateItem, (_event, input: UpdateContentLibraryItemInput) => library.updateItem(input))
  ipcMain.handle(CONTENT_LIBRARY_IPC.deleteItem, (_event, payload: ContentLibraryItemIdPayload) => library.deleteItem(payload.id))
  ipcMain.handle(CONTENT_LIBRARY_IPC.moveItem, (_event, input: MoveContentLibraryItemInput) => library.moveItem(input))
  ipcMain.handle(CONTENT_LIBRARY_IPC.pickImageFolder, async () => {
    const result = await dialog.showOpenDialog({ title: 'Chọn folder ảnh cho bài viết', properties: ['openDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(CONTENT_LIBRARY_IPC.pickTextFile, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import nội dung bài viết',
      properties: ['openFile'],
      filters: [{ name: 'Text / CSV', extensions: ['txt', 'csv'] }, { name: 'All files', extensions: ['*'] }]
    })
    const filePath = result.canceled ? undefined : result.filePaths[0]
    if (!filePath) return null
    const fileStat = await stat(filePath)
    if (fileStat.size > MAX_IMPORT_FILE_BYTES) throw new Error('File import lớn hơn giới hạn 10 MB.')
    return { path: filePath, content: await readFile(filePath, 'utf8') }
  })

  return {
    dispose: () => {
      for (const channel of Object.values(CONTENT_LIBRARY_IPC)) ipcMain.removeHandler(channel)
    }
  }
}
