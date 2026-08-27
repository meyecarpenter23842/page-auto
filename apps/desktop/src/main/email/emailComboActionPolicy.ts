import type { HotmailActionStatus } from '../../shared/hotmail'
import type {
  HotmailComboOperation,
  HotmailComboRecoveryOperation,
  HotmailComboStage
} from '../../shared/emailCombo'

export interface EmailComboProgress {
  nextStageIndex: number
  awaitingManual: boolean
  stopped: boolean
  completed: boolean
}

export function emailComboStagePlan(operation: HotmailComboOperation): HotmailComboStage[] {
  return operation === 'password_then_recovery'
    ? ['password', 'recovery_write']
    : ['recovery_remove', 'recovery_write', 'password']
}

export function recoveryOperationForCombo(
  operation: HotmailComboOperation,
  requested: HotmailComboRecoveryOperation | undefined
): HotmailComboRecoveryOperation {
  if (operation === 'reset_recovery_then_password') return 'add'
  return requested === 'add' ? 'add' : 'replace'
}

export function advanceEmailComboStage(
  stageIndex: number,
  status: HotmailActionStatus,
  totalStages: number
): EmailComboProgress {
  if (status === 'success') {
    const nextStageIndex = stageIndex + 1
    return {
      nextStageIndex,
      awaitingManual: false,
      stopped: false,
      completed: nextStageIndex >= totalStages
    }
  }
  if (status === 'needs_attention') {
    return {
      nextStageIndex: stageIndex,
      awaitingManual: true,
      stopped: true,
      completed: false
    }
  }
  return {
    nextStageIndex: stageIndex,
    awaitingManual: false,
    stopped: true,
    completed: false
  }
}

export function redactEmailComboSecrets(message: string, secrets: Array<string | null | undefined>): string {
  let safe = message
  for (const secret of secrets) {
    if (!secret) continue
    safe = safe.split(secret).join('[REDACTED]')
  }
  return safe
}
