import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import {
  SCENARIO_RUNNER_IPC,
  type ScenarioRunnerStartPayload
} from '../shared/scenarioRunnerRuntime'
import { ScenarioActionWorkerManager } from './browser/scenarioActionWorkerManager'
import { AppSettingsRepository } from './database/appSettingsRepository'
import { AccountExecutionCoordinator } from './services/accountExecutionCoordinator'
import { ScenarioRunnerService } from './services/scenarioRunnerService'

export interface ScenarioRunnerIpcRuntime { dispose: () => void }

interface ScenarioRunnerIpcOptions {
  database: Database.Database
  dataDirectory: string
}

export function registerScenarioRunnerIpcHandlers(options: ScenarioRunnerIpcOptions): ScenarioRunnerIpcRuntime {
  const appSettings = new AppSettingsRepository(options.database)
  const workers = new ScenarioActionWorkerManager(() => appSettings.get().runtime)
  const service = new ScenarioRunnerService(
    options.database,
    workers,
    new AccountExecutionCoordinator(),
    options.dataDirectory,
    () => appSettings.get()
  )

  ipcMain.handle(SCENARIO_RUNNER_IPC.start, (_event, payload: ScenarioRunnerStartPayload) => service.start(payload))
  ipcMain.handle(SCENARIO_RUNNER_IPC.status, () => service.status())
  ipcMain.handle(SCENARIO_RUNNER_IPC.stop, () => service.stop())

  return {
    dispose: () => {
      service.dispose()
      for (const channel of Object.values(SCENARIO_RUNNER_IPC)) ipcMain.removeHandler(channel)
    }
  }
}
