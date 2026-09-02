import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import {
  PAGE_BUSINESS_BINDING_IPC,
  type CreatePageBusinessBindingInput,
  type ListPageBusinessBindingsPayload,
  type PageBusinessBindingIdPayload,
  type UpdatePageBusinessBindingPayload
} from '../shared/pageBusinessBindings'
import { PageBusinessBindingRepository } from './database/pageBusinessBindingRepository'

export interface PageBusinessBindingIpcRuntime { dispose: () => void }

export function registerPageBusinessBindingIpcHandlers(database: Database.Database): PageBusinessBindingIpcRuntime {
  const repository = new PageBusinessBindingRepository(database)

  ipcMain.handle(PAGE_BUSINESS_BINDING_IPC.list, (_event, payload?: ListPageBusinessBindingsPayload) => repository.list(payload?.businessType))
  ipcMain.handle(PAGE_BUSINESS_BINDING_IPC.create, (_event, input: CreatePageBusinessBindingInput) => repository.create(input))
  ipcMain.handle(PAGE_BUSINESS_BINDING_IPC.update, (_event, payload: UpdatePageBusinessBindingPayload) => repository.update(payload))
  ipcMain.handle(PAGE_BUSINESS_BINDING_IPC.delete, (_event, payload: PageBusinessBindingIdPayload) => repository.delete(payload.id))

  return {
    dispose: () => {
      for (const channel of Object.values(PAGE_BUSINESS_BINDING_IPC)) ipcMain.removeHandler(channel)
    }
  }
}
