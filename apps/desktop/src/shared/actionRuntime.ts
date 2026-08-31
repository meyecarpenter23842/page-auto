import type { ActionActor, ActionConfig, ActionResult } from './actionRegistry'

export const ACTION_RUNTIME_ERROR_CODES = [
  'action_not_registered',
  'action_not_implemented',
  'action_actor_unsupported',
  'action_config_invalid',
  'page_uid_required',
  'session_needs_login',
  'checkpoint_required',
  'page_switch_failed',
  'page_identity_unconfirmed',
  'profile_identity_unconfirmed',
  'navigation_failed',
  'network_timeout',
  'browser_unavailable',
  'action_stopped',
  'executor_exception'
] as const

export type ActionRuntimeErrorCode = typeof ACTION_RUNTIME_ERROR_CODES[number]
export type ActionLogLevel = 'debug' | 'info' | 'warning' | 'error'
export type ActionRunStage = 'validating' | 'preparing_actor' | 'executing' | 'retry_wait' | 'completed'

export type ActionActorContext =
  | { kind: Extract<ActionActor, 'profile'>; accountId: number; accountUid: string }
  | { kind: Extract<ActionActor, 'page'>; accountId: number; accountUid: string; pageUid: string }

export interface ActionRetryPolicy {
  maxAttempts: number
  delayMs: number
  retryableCodes: readonly string[]
}

export interface ActionRunRequest {
  runKey: string
  scenarioActionId?: number
  actionType: string
  label: string
  actor: ActionActorContext
  config: unknown
  runtimeData?: unknown
  retry?: Partial<ActionRetryPolicy>
}

export interface ActionLogEvent {
  runKey: string
  actionType: string
  actor: ActionActor
  stage: ActionRunStage
  level: ActionLogLevel
  message: string
  at: number
  attempt?: number
  code?: string
  data?: Record<string, unknown>
}

export interface ActionRunControl {
  isStopped(): boolean
  waitIfPaused(): Promise<void>
  sleep(delayMs: number): Promise<void>
}

export interface ActionPreparationContext {
  request: ActionRunRequest
  control: ActionRunControl
  log(level: ActionLogLevel, message: string, code?: string, data?: Record<string, unknown>): void
}

export interface ActionPreparationHost {
  prepare(context: ActionPreparationContext): Promise<ActionPreparationResult>
}

export interface ActionExecutionSummary {
  result: ActionResult
  normalizedConfig: ActionConfig | null
  attempts: number
  startedAt: number
  finishedAt: number
}

export type ActionPreparationResult =
  | { status: 'ready' }
  | { status: 'blocked'; result: ActionResult }

export function actionRuntimeResult(
  status: ActionResult['status'],
  code: ActionRuntimeErrorCode,
  message: string,
  data?: Record<string, unknown>
): ActionResult {
  return {
    status,
    code,
    message,
    ...(data === undefined ? {} : { data })
  }
}
