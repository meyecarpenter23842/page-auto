import type { PostingCheckpointKind } from './posting'

export const FACEBOOK_CHECKPOINT_SURFACES = ['mbasic', 'mobile', 'desktop'] as const
export type FacebookCheckpointSurface = (typeof FACEBOOK_CHECKPOINT_SURFACES)[number]
export type FacebookCheckpointWorkbenchKind = '282' | '956'

export type FacebookCheckpoint282Action = 'start' | 'recheck' | 'stop'
export type FacebookCheckpoint282AssetOrigin = 'canonical' | 'source'
export type FacebookCheckpoint282IdentityVerification = 'uid_match' | 'session_only'

export interface FacebookCheckpoint282RunAsset {
  path: string
  origin: FacebookCheckpoint282AssetOrigin
  replaceCanonical: boolean
  confirmedUsed: boolean
}

export type FacebookCheckpoint282AssetPromotionState =
  | 'promoted'
  | 'replaced'
  | 'not_needed'
  | 'skipped_unconfirmed'
  | 'skipped_unverified'
  | 'conflict'
  | 'error'

export interface FacebookCheckpoint282AssetPromotion {
  state: FacebookCheckpoint282AssetPromotionState
  message: string
  canonicalPath?: string | null
  archivedPaths?: string[]
}

export interface FacebookCheckpoint282RunPayload {
  accountId: number
  surface: FacebookCheckpointSurface
  action: FacebookCheckpoint282Action
  checkpointKind?: FacebookCheckpointWorkbenchKind
  evidenceFolder?: string | null
  asset?: FacebookCheckpoint282RunAsset | null
}

export type FacebookCheckpoint282State =
  | 'resolved'
  | 'waiting_manual'
  | 'different_checkpoint'
  | 'needs_login'
  | 'stopped'
  | 'error'

export interface FacebookCheckpoint282Result {
  accountId: number
  uid: string
  state: FacebookCheckpoint282State
  surface: FacebookCheckpointSurface
  checkpointKind?: PostingCheckpointKind
  identityVerification?: FacebookCheckpoint282IdentityVerification
  message: string
  evidencePath?: string | null
  assetPromotion?: FacebookCheckpoint282AssetPromotion
}
