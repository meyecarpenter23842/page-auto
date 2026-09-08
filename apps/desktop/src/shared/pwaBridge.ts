import type { PageTabStatus } from './pageTabs'
import type {
  RotationAccountRuntimeStatus,
  RotationRuntimeStatus,
  RotationWindowRuntimeStatus
} from './rotation'
import type { RunStatus } from './runs'

export const PWA_BRIDGE_SCHEMA_VERSION = 1 as const
export const PWA_BRIDGE_STALE_AFTER_MS = 15_000

export interface PwaBridgeSummary {
  totalPages: number
  activePages: number
  pausedPages: number
  successToday: number
  failedToday: number
  nextActionAt: number | null
}

export interface PwaBridgeAccountSnapshot {
  accountId: number
  uid: string
  name: string | null
  status: RotationAccountRuntimeStatus
  message: string | null
}

export interface PwaBridgeScheduleSnapshot {
  dayOfWeek: number
  startMinute: number
  endMinute: number
  status: RotationWindowRuntimeStatus | null
  currentAccountId: number | null
  groupRemaining: number | null
}

export interface PwaBridgeCurrentPostSnapshot {
  groupUid: string
  contentPreview: string
  contentLength: number
  imageCount: number
  postIndex: number
  variantIndex: number
}

export interface PwaBridgePageSnapshot {
  pageTabId: number
  name: string
  pageUid: string
  configuredStatus: PageTabStatus
  runtimeStatus: RotationRuntimeStatus
  runId: number | null
  runStatus: RunStatus | null
  message: string | null
  accountCount: number
  groupCount: number
  accountConcurrency: number
  postsPerAccount: number
  currentAccountId: number | null
  currentGroupUid: string | null
  nextActionAt: number | null
  cycle: number
  slotsCompletedThisTurn: number
  targetSlotsThisTurn: number
  progress: {
    total: number
    success: number
    failed: number
    skipped: number
    remaining: number
    percent: number
  } | null
  today: {
    success: number
    failed: number
  }
  accounts: PwaBridgeAccountSnapshot[]
  schedules: PwaBridgeScheduleSnapshot[]
  currentPost: PwaBridgeCurrentPostSnapshot | null
}

export interface PwaBridgeLogSnapshot {
  id: number
  timestamp: number
  pageTabId: number
  accountId: number | null
  pageUid: string | null
  groupUid: string
  action: string
  result: string
  errorCode: string | null
  errorMessage: string | null
  publishedUrl: string | null
}

export interface PwaBridgeSnapshot {
  schemaVersion: typeof PWA_BRIDGE_SCHEMA_VERSION
  generatedAt: number
  staleAfterMs: number
  summary: PwaBridgeSummary
  pages: PwaBridgePageSnapshot[]
  recentLogs: PwaBridgeLogSnapshot[]
}
