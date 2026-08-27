import type { HotmailActionStatus, HotmailNeedsAttentionReason, HotmailRecoveryOperation } from './hotmail'

export const HOTMAIL_COMBO_OPERATIONS = ['password_then_recovery', 'reset_recovery_then_password'] as const
export type HotmailComboOperation = (typeof HOTMAIL_COMBO_OPERATIONS)[number]

export const HOTMAIL_COMBO_STAGES = ['password', 'recovery_remove', 'recovery_write'] as const
export type HotmailComboStage = (typeof HOTMAIL_COMBO_STAGES)[number]

export type HotmailComboRecoveryOperation = Extract<HotmailRecoveryOperation, 'add' | 'replace'>

export interface HotmailComboActionPayload {
  accountIds: number[]
  /** Required when starting a combo. Main freezes the value for manual continuation. */
  operation?: HotmailComboOperation
  /** Used by password_then_recovery; reset_recovery_then_password always removes then adds. */
  recoveryOperation?: HotmailComboRecoveryOperation
  recoveryEmail?: string | null
  /** Required when starting a combo. Never returned in results or logs. */
  newPassword?: string
  /** Continue the exact pending stage in the same live Email session. */
  confirmCompleted?: boolean
}

export interface HotmailComboStageResult {
  stage: HotmailComboStage
  status: HotmailActionStatus
  message: string
  needsAttentionReason?: HotmailNeedsAttentionReason
}

export interface HotmailComboActionResult {
  accountId: number
  status: HotmailActionStatus
  message: string
  stages: HotmailComboStageResult[]
  completedStages: HotmailComboStage[]
  pendingStage?: HotmailComboStage
  passwordUpdated: boolean
  backupEmail: string | null
}

export interface HotmailComboBatchResult {
  results: HotmailComboActionResult[]
}
