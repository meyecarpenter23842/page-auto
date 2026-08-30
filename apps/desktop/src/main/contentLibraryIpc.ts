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
import { LegacyCanonicalPostBridge } from './database/legacyCanonicalPostBridge'

export interface ContentLibraryIpcRuntime {
  dispose: () => void
}

const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024

export function registerContentLibraryIpcHandlers(database: Database.Database): ContentLibraryIpcRuntime {
  const library = new ContentLibraryRepository(database)
  const bridge = new LegacyCanonicalPostBridge(database)

  ipcMain.handle(CONTENT_LIBRARY_IPC.list, () => {
    bridge.syncAllGlobalSets()
    return library.list()
  })
  ipcMain.handle(CONTENT_LIBRARY_IPC.get, (_event, payload: ContentLibrarySetIdPayload) => {
    bridge.syncGlobalSet(payload.id)
    return library.get(payload.id)
  })
  ipcMain.handle(CONTENT_LIBRARY_IPC.createSet, (_event, input: CreateContentLibrarySetInput) => {
    const created = library.createSet(input)
    bridge.syncGlobalSet(created.id)
    return created
  })
  ipcMain.handle(CONTENT_LIBRARY_IPC.renameSet, (_event, input: RenameContentLibrarySetInput) => {
    const renamed = library.renameSet(input)
    bridge.syncGlobalSet(renamed.id)
    return renamed
  })
  ipcMain.handle(CONTENT_LIBRARY_IPC.deleteSet, (_event, payload: ContentLibrarySetIdPayload) => {
    const deleted = library.deleteSet(payload.id)
    if (deleted) bridge.syncGlobalSet(payload.id)
    return deleted
  })
  ipcMain.handle(CONTENT_LIBRARY_IPC.createItem, (_event, input: CreateContentLibraryItemInput) => {
    const result = library.createItem(input)
    bridge.syncGlobalSet(result.id)
    return result
  })
  ipcMain.handle(CONTENT_LIBRARY_IPC.updateItem, (_event, input: UpdateContentLibraryItemInput) => {
    const result = library.updateItem(input)
    bridge.syncGlobalSet(result.id)
    return result
  })
  ipcMain.handle(CONTENT_LIBRARY_IPC.deleteItem, (_event, payload: ContentLibraryItemIdPayload) => {
    const result = library.deleteItem(payload.id)
    bridge.syncGlobalSet(result.id)
    return result
  })
  ipcMain.handle(CONTENT_LIBRARY_IPC.moveItem, (_event, input: MoveContentLibraryItemInput) => {
    const result = library.moveItem(input)
    bridge.syncGlobalSet(result.id)
    return result
  })
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
