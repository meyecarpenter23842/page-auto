import type {
  ContentMode,
  PageTabImageConfig,
  PageTabRotationConfig,
  PageTabScheduleInput
} from './pageTabs'

export const RUN_STATUSES = ['created', 'running', 'paused', 'completed', 'stopped', 'failed'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export const RUN_ITEM_STATUSES = ['pending', 'processing', 'success', 'failed', 'skipped'] as const
export type RunItemStatus = (typeof RUN_ITEM_STATUSES)[number]
export type RunItemTerminalStatus = Extract<RunItemStatus, 'success' | 'failed' | 'skipped'>

export interface RunSnapshotAccount {
  accountId: number
  enabled: boolean
  sortOrder: number
  postsPerTurn: number | null
}

export interface RunSnapshot {
  version: 1
  pageTabId: number
  tabName: string
  pageUid: string
  rotation: PageTabRotationConfig
  accounts: RunSnapshotAccount[]
  schedules: PageTabScheduleInput[]
  contentMode: ContentMode
  contents: string[]
  image: PageTabImageConfig
  groupSourceCount: number
}

export interface RunRecord {
  id: number
  pageTabId: number | null
  status: RunStatus
  tabName: string
  pageUid: string
  snapshot: RunSnapshot
  createdAt: number
  startedAt: number | null
  pausedAt: number | null
  completedAt: number | null
  updatedAt: number
}

export interface RunMetrics {
  total: number
  pending: number
  processing: number
  success: number
  failed: number
  skipped: number
  remaining: number
  progressPercent: number
}

export interface RunItem {
  id: number
  runId: number
  sourceGroupItemId: number | null
  groupUid: string
  sortOrder: number
  status: RunItemStatus
  attemptCount: number
  lastError: string | null
  startedAt: number | null
  finishedAt: number | null
  updatedAt: number
}

export interface RunDetails {
  run: RunRecord
  metrics: RunMetrics
}

export interface CreateRunPayload {
  pageTabId: number
}

export interface RunIdPayload {
  runId: number
}

export interface CompleteRunItemPayload {
  runId: number
  itemId: number
  status: RunItemTerminalStatus
  errorMessage?: string
}
