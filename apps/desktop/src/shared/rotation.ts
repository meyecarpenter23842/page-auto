import type { PostingCheckpointKind, PostingJobResult } from './posting'
import type { RunDetails } from './runs'

export const ROTATION_RUNTIME_STATUSES = [
  'idle',
  'starting',
  'running',
  'paused',
  'waiting_window',
  'stopping',
  'stopped',
  'completed',
  'error'
] as const
export type RotationRuntimeStatus = (typeof ROTATION_RUNTIME_STATUSES)[number]

export const ROTATION_ACCOUNT_RUNTIME_STATUSES = [
  'not_run',
  'completed_turn',
  'running',
  'error',
  'waiting'
] as const
export type RotationAccountRuntimeStatus = (typeof ROTATION_ACCOUNT_RUNTIME_STATUSES)[number]

export const ROTATION_WINDOW_RUNTIME_STATUSES = [
  'upcoming',
  'running',
  'closed_account_cycle',
  'closed_time_remaining_accounts'
] as const
export type RotationWindowRuntimeStatus = (typeof ROTATION_WINDOW_RUNTIME_STATUSES)[number]

export interface RotationAccountRuntimeState {
  accountId: number
  status: RotationAccountRuntimeStatus
  message: string | null
  checkpointKind?: PostingCheckpointKind
}

export interface RotationWindowRuntimeState {
  key: string
  dateKey: string
  dayOfWeek: number
  startMinute: number
  endMinute: number
  sortOrder: number
  status: RotationWindowRuntimeStatus
  currentAccountId: number | null
  slotsCompletedThisTurn: number
  targetSlotsThisTurn: number
  groupRemaining: number
  closedAt: number | null
}

export interface PostingJobPreview {
  groupUid: string
  contentPreview: string
  contentLength: number
  imageCount: number
  postIndex: number
  variantIndex: number
}

export interface RotationPageTabPayload {
  pageTabId: number
}

export interface RotationRuntimeSnapshot {
  pageTabId: number
  runId: number | null
  status: RotationRuntimeStatus
  currentAccountId: number | null
  currentAccountIndex: number | null
  slotsCompletedThisTurn: number
  targetSlotsThisTurn: number
  cycle: number
  nextActionAt: number | null
  message: string | null
  lastResult: PostingJobResult | null
  run: RunDetails | null
  /** Main-owned ephemeral state, populated by PageTabWorkerManager. */
  accountStates?: RotationAccountRuntimeState[]
  /** Current prepared Group post. Paths/secrets are intentionally excluded. */
  currentPostPreview?: PostingJobPreview | null
  /** Persisted/live state of each configured schedule window for the current local day. */
  windowStates?: RotationWindowRuntimeState[]
}
