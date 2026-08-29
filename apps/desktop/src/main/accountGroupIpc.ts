import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import {
  ACCOUNT_GROUP_IPC,
  type AccountGroupIdPayload,
  type AssignAccountsToGroupInput,
  type CreateAccountGroupInput,
  type RenameAccountGroupInput
} from '../shared/accountGroups'
import { AccountGroupRepository } from './database/accountGroupRepository'

export interface AccountGroupIpcRuntime {
  dispose: () => void
}

export function registerAccountGroupIpcHandlers(database: Database.Database): AccountGroupIpcRuntime {
  const groups = new AccountGroupRepository(database)

  ipcMain.handle(ACCOUNT_GROUP_IPC.overview, () => groups.overview())
  ipcMain.handle(ACCOUNT_GROUP_IPC.create, (_event, input: CreateAccountGroupInput) => groups.create(input))
  ipcMain.handle(ACCOUNT_GROUP_IPC.rename, (_event, input: RenameAccountGroupInput) => groups.rename(input))
  ipcMain.handle(ACCOUNT_GROUP_IPC.delete, (_event, payload: AccountGroupIdPayload) => groups.delete(payload.id))
  ipcMain.handle(ACCOUNT_GROUP_IPC.assign, (_event, input: AssignAccountsToGroupInput) => groups.assign(input))

  return {
    dispose: () => {
      for (const channel of Object.values(ACCOUNT_GROUP_IPC)) ipcMain.removeHandler(channel)
    }
  }
}
