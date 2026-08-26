import type { PostingJobResult } from './posting'
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

export interface RotationAccountRuntimeState {
  accountId: number
  status: RotationAccountRuntimeStatus
  message: string | null
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
}
