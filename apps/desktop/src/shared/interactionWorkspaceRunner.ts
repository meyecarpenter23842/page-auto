export const INTERACTION_WORKSPACE_RUNNER_IPC = {
  start: 'interaction-workspace-runner:start',
  status: 'interaction-workspace-runner:status',
  pause: 'interaction-workspace-runner:pause',
  resume: 'interaction-workspace-runner:resume',
  stop: 'interaction-workspace-runner:stop'
} as const

export type InteractionWorkspaceRunState =
  | 'running'
  | 'paused'
  | 'stopping'
  | 'completed'
  | 'stopped'
  | 'failed'

export type InteractionWorkspaceRunAccountState =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'needs_attention'
  | 'stopped'

export type InteractionWorkspaceRunLogLevel = 'debug' | 'info' | 'warning' | 'error'

export interface InteractionWorkspaceRunIdPayload {
  workspaceId: number
}

export interface InteractionWorkspaceRunStartPayload {
  workspaceId: number
}

export interface InteractionWorkspaceFrozenSnapshot {
  workspaceId: number
  workspaceLabel: string
  configJson: string
  accountIds: number[]
  actionTypes: string[]
  createdAt: number
}

export interface InteractionWorkspaceRunAccountRuntime {
  accountId: number
  accountUid: string
  state: InteractionWorkspaceRunAccountState
  attempted: number
  success: number
  currentActionType: string | null
  currentActionLabel: string | null
  message: string | null
}

export interface InteractionWorkspaceRunLogEntry {
  id: number
  at: number
  level: InteractionWorkspaceRunLogLevel
  message: string
  accountId?: number
  actionType?: string
}

export interface InteractionWorkspaceRunSnapshot {
  runId: string
  workspaceId: number
  state: InteractionWorkspaceRunState
  startedAt: number
  finishedAt: number | null
  frozen: InteractionWorkspaceFrozenSnapshot
  accountRuntimes: InteractionWorkspaceRunAccountRuntime[]
  logs: InteractionWorkspaceRunLogEntry[]
  message: string | null
}
