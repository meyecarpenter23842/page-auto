import type { PostingCheckpointKind } from './posting'

export const FACEBOOK_CHECKPOINT_SURFACES = ['mbasic', 'mobile', 'desktop'] as const
export type FacebookCheckpointSurface = (typeof FACEBOOK_CHECKPOINT_SURFACES)[number]

export type FacebookCheckpoint282Action = 'start' | 'recheck'

export interface FacebookCheckpoint282RunPayload {
  accountId: number
  surface: FacebookCheckpointSurface
  action: FacebookCheckpoint282Action
  evidenceFolder?: string | null
}

export type FacebookCheckpoint282State =
  | 'resolved'
  | 'waiting_manual'
  | 'different_checkpoint'
  | 'needs_login'
  | 'error'

export interface FacebookCheckpoint282Result {
  accountId: number
  uid: string
  state: FacebookCheckpoint282State
  surface: FacebookCheckpointSurface
  checkpointKind?: PostingCheckpointKind
  message: string
  evidencePath?: string | null
}
