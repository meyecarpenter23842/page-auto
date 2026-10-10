import { dialog, ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import { readFile, stat } from 'node:fs/promises'
import {
  CANONICAL_CONTENT_LIBRARY_SET_ID,
  CONTENT_LIBRARY_IPC,
  type ContentLibraryItemIdPayload,
  type ContentLibrarySetIdPayload,
  type CreateContentLibraryItemInput,
  type CreateContentLibrarySetInput,
  type MoveContentLibraryItemInput,
  type RenameContentLibrarySetInput,
  type UpdateContentLibraryItemInput
} from '../shared/contentLibrary'
import { CanonicalContentLibraryRepository } from './database/canonicalContentLibraryRepository'
import { CanonicalPostCollectionRepository } from './database/canonicalPostCollectionRepository'

export interface ContentLibraryIpcRuntime {
  dispose: () => void
}

const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024

export function registerContentLibraryIpcHandlers(database: Database.Database): ContentLibraryIpcRuntime {
  const canonicalLibrary = new CanonicalContentLibraryRepository(database)
  const categories = new CanonicalPostCollectionRepository(database)

  ipcMain.handle(CONTENT_LIBRARY_IPC.list, () => [canonicalLibrary.summary(), ...categories.list()])
  ipcMain.handle(CONTENT_LIBRARY_IPC.get, (_event, payload: ContentLibrarySetIdPayload) => (
    payload.id === CANONICAL_CONTENT_LIBRARY_SET_ID ? canonicalLibrary.get() : categories.get(payload.id)
  ))
  ipcMain.handle(CONTENT_LIBRARY_IPC.createSet, (_event, input: CreateContentLibrarySetInput) => categories.create(input))
  ipcMain.handle(CONTENT_LIBRARY_IPC.renameSet, (_event, input: RenameContentLibrarySetInput) => {
    if (input.id === CANONICAL_CONTENT_LIBRARY_SET_ID) {
      throw new Error('“Tất cả bài viết” là kho bài gốc và không thể đổi tên.')
    }
    return categories.rename(input)
  })
  ipcMain.handle(CONTENT_LIBRARY_IPC.deleteSet, (_event, payload: ContentLibrarySetIdPayload) => {
    if (payload.id === CANONICAL_CONTENT_LIBRARY_SET_ID) {
      throw new Error('“Tất cả bài viết” là kho bài gốc và không thể xóa.')
    }
    return categories.delete(payload.id)
  })
  ipcMain.handle(CONTENT_LIBRARY_IPC.createItem, (_event, input: CreateContentLibraryItemInput) => (
    input.contentSetId === CANONICAL_CONTENT_LIBRARY_SET_ID
      ? canonicalLibrary.create(input)
      : categories.createPost(input.contentSetId, input)
  ))
  ipcMain.handle(CONTENT_LIBRARY_IPC.updateItem, (_event, input: UpdateContentLibraryItemInput) => {
    const updated = canonicalLibrary.update(input)
    if (input.contentSetId !== undefined && input.contentSetId !== CANONICAL_CONTENT_LIBRARY_SET_ID) {
      return categories.setItemEnabled(input.contentSetId, input.id, input.enabled)
    }
    return updated
  })
  ipcMain.handle(CONTENT_LIBRARY_IPC.deleteItem, (_event, payload: ContentLibraryItemIdPayload) => {
    categories.deleteCanonicalItem(payload.id)
    return canonicalLibrary.get()
  })
  ipcMain.handle(CONTENT_LIBRARY_IPC.moveItem, (_event, input: MoveContentLibraryItemInput) => {
    if (input.itemIds?.length) {
      const targetContentSetId = input.targetContentSetId ?? null
      categories.moveItems(input.itemIds, targetContentSetId)
      return targetContentSetId === null
        ? canonicalLibrary.get()
        : categories.get(targetContentSetId) ?? canonicalLibrary.get()
    }
    if (input.contentSetId === CANONICAL_CONTENT_LIBRARY_SET_ID) return canonicalLibrary.move()
    return categories.moveItem(input.contentSetId, input.itemId, input.direction)
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
