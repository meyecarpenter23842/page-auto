import type { PageWallRunNowPayload } from './pageWall'
import type {
  PostingErrorCode,
  PostingResultStatus,
  PostingSessionValidation
} from './posting'

export const PAGE_WALL_JOB_STATUSES = ['pending', 'running', 'success', 'failed', 'cancelled'] as const
export type PageWallJobStatus = (typeof PAGE_WALL_JOB_STATUSES)[number]

export interface PageWallSchedulePayload extends PageWallRunNowPayload {
  scheduledAt: number
}

export interface PageWallJobIdPayload {
  jobId: number
}

export interface PageWallJobLogEntry {
  at: number
  message: string
}

export interface PageWallJobRecord {
  id: number
  status: PageWallJobStatus
  scheduledAt: number
  pageTabId: number
  pageTabName: string
  pageUid: string
  accountId: number
  accountUid: string
  accountName: string | null
  content: string
  imagePaths: string[]
  /** Derived from the audit marker for recurring jobs; absent/null for one-shot jobs. */
  occurrenceKey?: string | null
  resultStatus: PostingResultStatus | null
  resultCode: PostingErrorCode | null
  resultMessage: string | null
  publishedUrl: string | null
  screenshotPath: string | null
  tracePath: string | null
  sessionValidation: PostingSessionValidation | null
  logs: PageWallJobLogEntry[]
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  updatedAt: number
}
