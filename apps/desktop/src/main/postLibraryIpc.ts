import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import { IPC_CHANNELS } from '../ipc/channels'
import type { PageTabIdPayload, SavePageTabPostLibraryInput } from '../shared/pageTabs'
import { PageTabPostRepository } from './database/pageTabPostRepository'

export interface PostLibraryIpcRuntime {
  dispose: () => void
}

export function registerPostLibraryIpcHandlers(database: Database.Database): PostLibraryIpcRuntime {
  const posts = new PageTabPostRepository(database)

  ipcMain.handle(IPC_CHANNELS.pageTabsPostLibraryGet, (_event, payload: PageTabIdPayload) => posts.get(payload.id))
  ipcMain.handle(IPC_CHANNELS.pageTabsPostLibrarySave, (_event, payload: SavePageTabPostLibraryInput) => posts.save(payload))

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.pageTabsPostLibraryGet)
      ipcMain.removeHandler(IPC_CHANNELS.pageTabsPostLibrarySave)
    }
  }
}
