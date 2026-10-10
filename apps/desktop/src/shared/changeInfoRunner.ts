import type { ActionResultStatus } from './actionRegistry'

export const CHANGE_INFO_RUNNER_IPC = {
  start: 'change-info:runner:start',
  status: 'change-info:runner:status',
  pause: 'change-info:runner:pause',
  resume: 'change-info:runner:resume',
  stop: 'change-info:runner:stop'
} as const

export type ChangeInfoRunState =
  | 'running'
  | 'paused'
  | 'stopping'
  | 'success'
  | 'partial_success'
  | 'needs_attention'
  | 'failed'
  | 'stopped'

export type ChangeInfoAccountRunState =
  | 'queued'
  | 'running'
  | 'success'
  | 'partial_success'
  | 'needs_attention'
  | 'failed'
  | 'stopped'

export interface ChangeInfoActionRunResult {
  key: string
  actionType: string
  label: string
  status: ActionResultStatus
  code: string | null
  message: string | null
  startedAt: number
  finishedAt: number
}

export interface ChangeInfoAccountRunRuntime {
  accountId: number
  uid: string
  state: ChangeInfoAccountRunState
  currentActionKey: string | null
  currentActionLabel: string | null
  message: string | null
  results: ChangeInfoActionRunResult[]
}

export interface ChangeInfoRunLogEntry {
  id: number
  at: number
  level: 'debug' | 'info' | 'warning' | 'error'
  message: string
  accountId?: number
  actionType?: string
}

export interface ChangeInfoRunSnapshot {
  workspaceId: number
  runId: string
  state: ChangeInfoRunState
  accountConcurrency: number
  startedAt: number
  finishedAt: number | null
  message: string | null
  accounts: ChangeInfoAccountRunRuntime[]
  logs: ChangeInfoRunLogEntry[]
}

export interface ChangeInfoWorkspaceRunPayload {
  workspaceId: number
}

export interface ChangeInfoRunnerApi {
  start(payload: ChangeInfoWorkspaceRunPayload): Promise<ChangeInfoRunSnapshot>
  status(payload: ChangeInfoWorkspaceRunPayload): Promise<ChangeInfoRunSnapshot | null>
  pause(payload: ChangeInfoWorkspaceRunPayload): Promise<ChangeInfoRunSnapshot | null>
  resume(payload: ChangeInfoWorkspaceRunPayload): Promise<ChangeInfoRunSnapshot | null>
  stop(payload: ChangeInfoWorkspaceRunPayload): Promise<ChangeInfoRunSnapshot | null>
}

export function isActiveChangeInfoRunState(state: ChangeInfoRunState | null | undefined): boolean {
  return state === 'running' || state === 'paused' || state === 'stopping'
}
