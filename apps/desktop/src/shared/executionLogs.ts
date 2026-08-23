import type { RunDetails } from './runs'

export const RETRY_DISPOSITIONS = ['retryable', 'manual_review', 'blocked', 'not_applicable'] as const
export type RetryDisposition = (typeof RETRY_DISPOSITIONS)[number]

export interface ExecutionLogRecord {
  id: number
  timestamp: number
  runId: number | null
  runItemId: number | null
  pageTabId: number | null
  accountId: number | null
  pageUid: string | null
  groupUid: string | null
  contentIndex: number | null
  imagePaths: string[]
  action: string
  result: string
  errorCode: string | null
  errorMessage: string | null
  screenshotPath: string | null
  publishedUrl: string | null
  attemptCount: number
  retryDisposition: RetryDisposition
}

export interface ExecutionLogFilters {
  pageTabId?: number
  accountId?: number
  groupUid?: string
  result?: string
  fromTimestamp?: number
  toTimestamp?: number
  limit?: number
}

export interface CreateExecutionLogInput extends Omit<ExecutionLogRecord, 'id' | 'timestamp' | 'imagePaths'> {
  timestamp?: number
  imagePaths?: string[]
}

export interface RetryRunItemPayload {
  runItemId: number
}

export interface RetryRunItemResult {
  itemId: number
  run: RunDetails
  message: string
}
