import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import {
  ACTION_WORKSPACE_IPC,
  type ActionWorkspaceIdPayload,
  type CreateActionWorkspaceInput,
  type UpdateActionWorkspacePayload
} from '../shared/actionWorkspaces'
import { ActionWorkspaceRepository } from './database/actionWorkspaceRepository'

export interface ActionWorkspaceIpcRuntime { dispose: () => void }

export function registerActionWorkspaceIpcHandlers(database: Database.Database): ActionWorkspaceIpcRuntime {
  const repository = new ActionWorkspaceRepository(database)

  ipcMain.handle(ACTION_WORKSPACE_IPC.list, () => repository.list())
  ipcMain.handle(ACTION_WORKSPACE_IPC.create, (_event, input: CreateActionWorkspaceInput) => repository.create(input))
  ipcMain.handle(ACTION_WORKSPACE_IPC.update, (_event, payload: UpdateActionWorkspacePayload) => repository.update(payload))
  ipcMain.handle(ACTION_WORKSPACE_IPC.delete, (_event, payload: ActionWorkspaceIdPayload) => repository.delete(payload.id))

  return {
    dispose: () => {
      for (const channel of Object.values(ACTION_WORKSPACE_IPC)) ipcMain.removeHandler(channel)
    }
  }
}
