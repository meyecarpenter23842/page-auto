export const SCENARIO_RUNNER_IPC = {
  start: 'scenario-runner:start',
  status: 'scenario-runner:status',
  stop: 'scenario-runner:stop'
} as const

export type ScenarioRunnerState = 'running' | 'stopping' | 'completed' | 'stopped' | 'failed'
export type ScenarioRunnerAccountState = 'queued' | 'running' | 'completed' | 'failed' | 'needs_attention' | 'stopped'
export type ScenarioRunnerLogLevel = 'debug' | 'info' | 'warning' | 'error'

export type ScenarioRunnerExecutionContext =
  | { kind: 'profile' }
  | { kind: 'page'; pageTabId: number; pageUid: string }

export interface ScenarioRunnerRuntimeSettings {
  randomScenarios: boolean
  randomScenarioCount: number
  secondaryProfile: boolean
  secondaryProfileCount: number
  parallelAccounts: number
  actionDelayMinSeconds: number
  actionDelayMaxSeconds: number
  accountSwitchDelayMinSeconds: number
  accountSwitchDelayMaxSeconds: number
  pauseAfterActions: number
  pauseMinutes: number
  pauseOnErrorMinutes: number
  repeat: boolean
  repeatCount: number
  pauseAfterAccounts: number
  pauseAfterAccountsMinutes: number
  proxyResetEnabled: boolean
  proxyThreadsPerProxy: number
  dcomResetEnabled: boolean
  dcomEveryAccounts: number
  startIndex: number
  limitPerAccount: number
}

export interface ScenarioRunnerStartPayload {
  accountIds: number[]
  scenarioIds: number[]
  settings: ScenarioRunnerRuntimeSettings
  executionContext?: ScenarioRunnerExecutionContext
}

export interface ScenarioRunnerAccountRuntime {
  accountId: number
  state: ScenarioRunnerAccountState
  total: number
  success: number
  currentScenarioId: number | null
  currentScenarioName: string | null
  currentActionType: string | null
  currentActionLabel: string | null
  message: string | null
}

export interface ScenarioRunnerLogEntry {
  id: number
  at: number
  level: ScenarioRunnerLogLevel
  message: string
  accountId?: number
  scenarioId?: number
  actionType?: string
}

export interface ScenarioRunnerSnapshot {
  runId: string
  state: ScenarioRunnerState
  startedAt: number
  finishedAt: number | null
  executionContext?: ScenarioRunnerExecutionContext
  accountRuntimes: ScenarioRunnerAccountRuntime[]
  logs: ScenarioRunnerLogEntry[]
  message: string | null
}