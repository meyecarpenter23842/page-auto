import type { AccountStatus } from './accounts'
import type { BrowserSettings, NetworkSettings, SessionSettings } from './appSettings'
import type { BrowserWindowPlacement } from './browserWindowLayout'
import type { ActionExecutionSummary, ActionLogEvent, ActionRunRequest } from './actionRuntime'
import type { FacebookSessionPolicyState } from './facebookSessionPolicy'

export interface ScenarioActionSessionAccount {
  id: number
  uid: string
  username: string | null
  password: string | null
  cookie: string | null
  twoFactorSecret: string | null
  name?: string | null
}

export interface ScenarioActionProxyConfig {
  server: string
  username?: string
  password?: string
}

export interface ScenarioActionWorkerJob {
  accountId: number
  profileDirectory: string
  browser: BrowserSettings
  session: SessionSettings
  network: NetworkSettings
  sessionAccount: ScenarioActionSessionAccount
  request: ActionRunRequest
  browserPlacement?: BrowserWindowPlacement | null
  userAgent?: string
  proxy?: ScenarioActionProxyConfig
}

export interface ScenarioActionWorkerResult {
  summary: ActionExecutionSummary
  sessionCookie: string | null
  accountName: string | null
  sessionState: 'valid' | 'needs_login' | 'verification_required' | null
  sessionPolicyState?: FacebookSessionPolicyState | null
  accountStatus?: AccountStatus
}

export type ScenarioActionWorkerRequestMessage =
  | { type: 'execute'; job: ScenarioActionWorkerJob }
  | { type: 'pause'; runKey: string }
  | { type: 'resume'; runKey: string }
  | { type: 'stop'; runKey: string }
  | { type: 'shutdown' }

export type ScenarioActionWorkerMessage =
  | { type: 'ready' }
  | { type: 'log'; event: ActionLogEvent }
  | { type: 'result'; runKey: string; result: ScenarioActionWorkerResult }
