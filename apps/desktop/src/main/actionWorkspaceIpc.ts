import { dialog, ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import {
  ACTION_WORKSPACE_IPC,
  type ActionWorkspaceIdPayload,
  type ActionWorkspacePresetIdPayload,
  type ActionWorkspacePresetListPayload,
  type CreateActionWorkspaceInput,
  type SaveActionWorkspacePresetInput,
  type UpdateActionWorkspacePayload
} from '../shared/actionWorkspaces'
import { ActionWorkspacePresetRepository } from './database/actionWorkspacePresetRepository'
import { ActionWorkspaceRepository } from './database/actionWorkspaceRepository'

export interface ActionWorkspaceIpcRuntime { dispose: () => void }

export function registerActionWorkspaceIpcHandlers(database: Database.Database): ActionWorkspaceIpcRuntime {
  const repository = new ActionWorkspaceRepository(database)
  const presets = new ActionWorkspacePresetRepository(database)

  ipcMain.handle(ACTION_WORKSPACE_IPC.list, () => repository.list())
  ipcMain.handle(ACTION_WORKSPACE_IPC.create, (_event, input: CreateActionWorkspaceInput) => repository.create(input))
  ipcMain.handle(ACTION_WORKSPACE_IPC.update, (_event, payload: UpdateActionWorkspacePayload) => repository.update(payload))
  ipcMain.handle(ACTION_WORKSPACE_IPC.delete, (_event, payload: ActionWorkspaceIdPayload) => repository.delete(payload.id))
  ipcMain.handle(ACTION_WORKSPACE_IPC.presetList, (_event, payload: ActionWorkspacePresetListPayload) => presets.list(payload.type))
  ipcMain.handle(ACTION_WORKSPACE_IPC.presetSave, (_event, input: SaveActionWorkspacePresetInput) => presets.save(input))
  ipcMain.handle(ACTION_WORKSPACE_IPC.presetDelete, (_event, payload: ActionWorkspacePresetIdPayload) => presets.delete(payload.id))
  ipcMain.handle(ACTION_WORKSPACE_IPC.pickTextFile, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Chọn file dữ liệu',
      properties: ['openFile'],
      filters: [
        { name: 'Text / CSV', extensions: ['txt', 'csv'] },
        { name: 'Tất cả file', extensions: ['*'] }
      ]
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle(ACTION_WORKSPACE_IPC.pickFolder, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Chọn thư mục dữ liệu',
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  return {
    dispose: () => {
      for (const channel of Object.values(ACTION_WORKSPACE_IPC)) ipcMain.removeHandler(channel)
    }
  }
}
