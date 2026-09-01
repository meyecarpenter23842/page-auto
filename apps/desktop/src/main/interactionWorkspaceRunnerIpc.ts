import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import {
  INTERACTION_WORKSPACE_RUNNER_IPC,
  type InteractionWorkspaceRunIdPayload,
  type InteractionWorkspaceRunStartPayload
} from '../shared/interactionWorkspaceRunner'
import { ScenarioActionWorkerManager } from './browser/scenarioActionWorkerManager'
import { AppSettingsRepository } from './database/appSettingsRepository'
import { AccountExecutionCoordinator } from './services/accountExecutionCoordinator'
import { InteractionWorkspaceRunnerService } from './services/interactionWorkspaceRunnerService'

export interface InteractionWorkspaceRunnerIpcRuntime { dispose: () => void }

interface InteractionWorkspaceRunnerIpcOptions {
  database: Database.Database
  dataDirectory: string
}

export function registerInteractionWorkspaceRunnerIpcHandlers(
  options: InteractionWorkspaceRunnerIpcOptions
): InteractionWorkspaceRunnerIpcRuntime {
  const appSettings = new AppSettingsRepository(options.database)
  const workers = new ScenarioActionWorkerManager(() => appSettings.get().runtime)
  const service = new InteractionWorkspaceRunnerService(
    options.database,
    workers,
    new AccountExecutionCoordinator(),
    options.dataDirectory,
    () => appSettings.get()
  )

  ipcMain.handle(
    INTERACTION_WORKSPACE_RUNNER_IPC.start,
    (_event, payload: InteractionWorkspaceRunStartPayload) => service.start(payload.workspaceId)
  )
  ipcMain.handle(
    INTERACTION_WORKSPACE_RUNNER_IPC.status,
    (_event, payload: InteractionWorkspaceRunIdPayload) => service.status(payload.workspaceId)
  )
  ipcMain.handle(
    INTERACTION_WORKSPACE_RUNNER_IPC.pause,
    (_event, payload: InteractionWorkspaceRunIdPayload) => service.pause(payload.workspaceId)
  )
  ipcMain.handle(
    INTERACTION_WORKSPACE_RUNNER_IPC.resume,
    (_event, payload: InteractionWorkspaceRunIdPayload) => service.resume(payload.workspaceId)
  )
  ipcMain.handle(
    INTERACTION_WORKSPACE_RUNNER_IPC.stop,
    (_event, payload: InteractionWorkspaceRunIdPayload) => service.stop(payload.workspaceId)
  )

  return {
    dispose: () => {
      service.dispose()
      for (const channel of Object.values(INTERACTION_WORKSPACE_RUNNER_IPC)) ipcMain.removeHandler(channel)
    }
  }
}
