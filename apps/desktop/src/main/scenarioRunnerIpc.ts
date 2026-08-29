import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import {
  SCENARIO_RUNNER_IPC,
  type ScenarioRunnerStartPayload
} from '../shared/scenarioRunnerRuntime'
import { BrowserWindowLayoutManager } from './browser/browserWindowLayoutManager'
import { ScenarioActionWorkerManager } from './browser/scenarioActionWorkerManager'
import { AppSettingsRepository } from './database/appSettingsRepository'
import { BrowserWindowLayoutRepository } from './database/browserWindowLayoutRepository'
import { AccountExecutionCoordinator } from './services/accountExecutionCoordinator'
import { PostingService } from './services/postingService'
import { ScenarioGroupPostAdapter } from './services/scenarioGroupPostAdapter'
import { ScenarioRunnerService } from './services/scenarioRunnerService'

export interface ScenarioRunnerIpcRuntime { dispose: () => void }

interface ScenarioRunnerIpcOptions {
  database: Database.Database
  dataDirectory: string
}

function isTerminalScenarioState(state: string): boolean {
  return state === 'completed' || state === 'failed' || state === 'stopped'
}

export function registerScenarioRunnerIpcHandlers(options: ScenarioRunnerIpcOptions): ScenarioRunnerIpcRuntime {
  const appSettings = new AppSettingsRepository(options.database)
  const browserWindowLayoutSettings = new BrowserWindowLayoutRepository(options.database)
  const browserWindowLayout = new BrowserWindowLayoutManager()
  const groupPosting = new PostingService(
    options.database,
    options.dataDirectory,
    () => appSettings.get().browser,
    () => appSettings.get().session,
    () => appSettings.get().network,
    () => appSettings.get().runtime,
    () => appSettings.get().logging,
    async () => undefined,
    browserWindowLayout,
    () => browserWindowLayoutSettings.get()
  )
  const groupPostAdapter = new ScenarioGroupPostAdapter(options.database, groupPosting)
  const workers = new ScenarioActionWorkerManager(() => appSettings.get().runtime, groupPostAdapter)
  const service = new ScenarioRunnerService(
    options.database,
    workers,
    new AccountExecutionCoordinator(),
    options.dataDirectory,
    () => appSettings.get()
  )

  ipcMain.handle(SCENARIO_RUNNER_IPC.start, (_event, payload: ScenarioRunnerStartPayload) => {
    const snapshot = service.start(payload)
    groupPostAdapter.beginScenarioRun(snapshot.runId, payload.accountIds)
    return snapshot
  })
  ipcMain.handle(SCENARIO_RUNNER_IPC.status, () => {
    const snapshot = service.status()
    if (snapshot && isTerminalScenarioState(snapshot.state)) groupPostAdapter.finishScenarioRun(snapshot.runId)
    return snapshot
  })
  ipcMain.handle(SCENARIO_RUNNER_IPC.stop, () => service.stop())

  return {
    dispose: () => {
      service.dispose()
      for (const channel of Object.values(SCENARIO_RUNNER_IPC)) ipcMain.removeHandler(channel)
    }
  }
}
