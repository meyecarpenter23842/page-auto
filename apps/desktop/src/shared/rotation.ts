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
}
