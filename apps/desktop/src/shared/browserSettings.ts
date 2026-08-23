import type { BrowserSettings } from './appSettings'

export const BROWSER_ENGINE_ERROR_CODES = [
  'not_found',
  'invalid_executable',
  'launch_failed',
  'timeout',
  'worker_crashed'
] as const

export type BrowserEngineErrorCode = (typeof BROWSER_ENGINE_ERROR_CODES)[number]
export type BrowserExecutableStatus = 'found' | 'not_found' | 'canceled' | 'invalid'

export interface BrowserExecutableResult {
  status: BrowserExecutableStatus
  executablePath: string | null
  version: string | null
  message: string
}

export interface BrowserTestRequest {
  settings: BrowserSettings
}

export interface BrowserTestResult {
  status: 'success' | 'failed'
  code?: BrowserEngineErrorCode
  executablePath: string | null
  version: string | null
  message: string
  launchDurationMs?: number
}

export interface BrowserTestWorkerReadyMessage {
  type: 'ready'
}

export interface BrowserTestWorkerRequestMessage {
  type: 'test'
  settings: BrowserSettings
}

export interface BrowserTestWorkerResultMessage {
  type: 'result'
  result: BrowserTestResult
}

export type BrowserTestWorkerMessage = BrowserTestWorkerReadyMessage | BrowserTestWorkerResultMessage
