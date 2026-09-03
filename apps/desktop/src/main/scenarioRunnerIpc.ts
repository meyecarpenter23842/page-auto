import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import {
  SCENARIO_RUNNER_IPC,
  type ScenarioRunnerStartPayload
} from '../shared/scenarioRunnerRuntime'
import { BrowserWindowLayoutManager } from './browser/browserWindowLayoutManager'
import { AppSettingsRepository } from './database/appSettingsRepository'
import { BrowserWindowLayoutRepository } from './database/browserWindowLayoutRepository'
import { FacebookSessionPolicyWorkerManager } from './facebook/facebookSessionPolicy'
import { AccountExecutionCoordinator } from './services/accountExecutionCoordinator'
import { PostingService } from './services/postingService'
import { ScenarioPostActionAdapter } from './services/scenarioPostActionAdapter'
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
  const posting = new PostingService(
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
  const postAdapter = new ScenarioPostActionAdapter(options.database, posting)
  const workers = new FacebookSessionPolicyWorkerManager(
    options.database,
    options.dataDirectory,
    () => appSettings.get().runtime,
    postAdapter
  )
  const service = new ScenarioRunnerService(
    options.database,
    workers,
    new AccountExecutionCoordinator(),
    options.dataDirectory,
    () => appSettings.get()
  )

  ipcMain.handle(SCENARIO_RUNNER_IPC.start, (_event, payload: ScenarioRunnerStartPayload) => {
    // Resolve every Content Library reference before Start. The returned object is a detached
    // content snapshot, so edits/deletes in the library cannot mutate the active Scenario run.
    const prepared = postAdapter.prepareScenarioRun(payload.scenarioIds)
    const snapshot = service.start(payload)
    postAdapter.beginScenarioRun(snapshot.runId, payload.accountIds, prepared)
    return snapshot
  })
  ipcMain.handle(SCENARIO_RUNNER_IPC.status, () => {
    const snapshot = service.status()
    if (snapshot && isTerminalScenarioState(snapshot.state)) postAdapter.finishScenarioRun(snapshot.runId)
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
