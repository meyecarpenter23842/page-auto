import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import {
  SCENARIO_IPC,
  type CreateScenarioActionInput,
  type CreateScenarioInput,
  type MoveScenarioActionPayload,
  type ScenarioActionIdPayload,
  type ScenarioIdPayload,
  type UpdateScenarioActionPayload,
  type UpdateScenarioPayload
} from '../shared/scenarios'
import { ScenarioRepository } from './database/scenarioRepository'

export interface ScenarioIpcRuntime { dispose: () => void }

export function registerScenarioIpcHandlers(database: Database.Database): ScenarioIpcRuntime {
  const repository = new ScenarioRepository(database)

  ipcMain.handle(SCENARIO_IPC.list, () => repository.list())
  ipcMain.handle(SCENARIO_IPC.get, (_event, payload: ScenarioIdPayload) => repository.get(payload.id))
  ipcMain.handle(SCENARIO_IPC.create, (_event, input: CreateScenarioInput) => repository.create(input))
  ipcMain.handle(SCENARIO_IPC.update, (_event, payload: UpdateScenarioPayload) => repository.update(payload))
  ipcMain.handle(SCENARIO_IPC.delete, (_event, payload: ScenarioIdPayload) => repository.delete(payload.id))
  ipcMain.handle(SCENARIO_IPC.actionCreate, (_event, input: CreateScenarioActionInput) => repository.createAction(input))
  ipcMain.handle(SCENARIO_IPC.actionUpdate, (_event, payload: UpdateScenarioActionPayload) => repository.updateAction(payload))
  ipcMain.handle(SCENARIO_IPC.actionDelete, (_event, payload: ScenarioActionIdPayload) => repository.deleteAction(payload.id))
  ipcMain.handle(SCENARIO_IPC.actionMove, (_event, payload: MoveScenarioActionPayload) => repository.moveAction(payload))

  return {
    dispose: () => {
      for (const channel of Object.values(SCENARIO_IPC)) ipcMain.removeHandler(channel)
    }
  }
}
