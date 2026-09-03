import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import {
  INTERACTION_WORKSPACE_RUNNER_IPC,
  type InteractionWorkspaceRunIdPayload,
  type InteractionWorkspaceRunStartPayload
} from '../shared/interactionWorkspaceRunner'
import { parsePageJoinGroupWorkspaceConfig } from '../shared/pageJoinGroup'
import { AppSettingsRepository } from './database/appSettingsRepository'
import { ActionWorkspaceRepository } from './database/actionWorkspaceRepository'
import { FacebookSessionPolicyWorkerManager } from './facebook/facebookSessionPolicy'
import { AccountExecutionCoordinator } from './services/accountExecutionCoordinator'
import { GroupWorkspaceRunnerService } from './services/groupWorkspaceRunnerService'
import { InteractionWorkspaceRunnerService } from './services/interactionWorkspaceRunnerService'
import { PageJoinGroupRunnerService } from './services/pageJoinGroupRunnerService'

export interface InteractionWorkspaceRunnerIpcRuntime { dispose: () => void }

interface InteractionWorkspaceRunnerIpcOptions {
  database: Database.Database
  dataDirectory: string
}

export function registerInteractionWorkspaceRunnerIpcHandlers(
  options: InteractionWorkspaceRunnerIpcOptions
): InteractionWorkspaceRunnerIpcRuntime {
  const appSettings = new AppSettingsRepository(options.database)
  const workers = new FacebookSessionPolicyWorkerManager(
    options.database,
    options.dataDirectory,
    () => appSettings.get().runtime
  )
  const accountExecution = new AccountExecutionCoordinator()
  const workspaces = new ActionWorkspaceRepository(options.database)
  const interactionService = new InteractionWorkspaceRunnerService(
    options.database,
    workers,
    accountExecution,
    options.dataDirectory,
    () => appSettings.get()
  )
  const groupService = new GroupWorkspaceRunnerService(
    options.database,
    workers,
    accountExecution,
    options.dataDirectory,
    () => appSettings.get()
  )
  const pageJoinGroupService = new PageJoinGroupRunnerService(
    options.database,
    workers,
    accountExecution,
    options.dataDirectory,
    () => appSettings.get()
  )

  const serviceFor = (workspaceId: number) => {
    const workspace = workspaces.get(workspaceId)
    if (!workspace) throw new Error(`Không tìm thấy workspace #${workspaceId}.`)
    if (workspace.type === 'group' && parsePageJoinGroupWorkspaceConfig(workspace.configJson)) {
      return pageJoinGroupService
    }
    return workspace.type === 'group' ? groupService : interactionService
  }

  ipcMain.handle(
    INTERACTION_WORKSPACE_RUNNER_IPC.start,
    (_event, payload: InteractionWorkspaceRunStartPayload) => serviceFor(payload.workspaceId).start(payload.workspaceId)
  )
  ipcMain.handle(
    INTERACTION_WORKSPACE_RUNNER_IPC.status,
    (_event, payload: InteractionWorkspaceRunIdPayload) => serviceFor(payload.workspaceId).status(payload.workspaceId)
  )
  ipcMain.handle(
    INTERACTION_WORKSPACE_RUNNER_IPC.pause,
    (_event, payload: InteractionWorkspaceRunIdPayload) => serviceFor(payload.workspaceId).pause(payload.workspaceId)
  )
  ipcMain.handle(
    INTERACTION_WORKSPACE_RUNNER_IPC.resume,
    (_event, payload: InteractionWorkspaceRunIdPayload) => serviceFor(payload.workspaceId).resume(payload.workspaceId)
  )
  ipcMain.handle(
    INTERACTION_WORKSPACE_RUNNER_IPC.stop,
    (_event, payload: InteractionWorkspaceRunIdPayload) => serviceFor(payload.workspaceId).stop(payload.workspaceId)
  )

  return {
    dispose: () => {
      pageJoinGroupService.dispose()
      groupService.dispose()
      interactionService.dispose()
      for (const channel of Object.values(INTERACTION_WORKSPACE_RUNNER_IPC)) ipcMain.removeHandler(channel)
    }
  }
}
