import { describe, expect, it } from 'vitest'
import {
  advanceEmailComboStage,
  emailComboStagePlan,
  recoveryOperationForCombo,
  redactEmailComboSecrets
} from './emailComboActionPolicy'

describe('emailComboActionPolicy', () => {
  it('keeps the required stage order for both E5.3 combos', () => {
    expect(emailComboStagePlan('password_then_recovery')).toEqual(['password', 'recovery_write'])
    expect(emailComboStagePlan('reset_recovery_then_password')).toEqual(['recovery_remove', 'recovery_write', 'password'])
    expect(recoveryOperationForCombo('password_then_recovery', 'add')).toBe('add')
    expect(recoveryOperationForCombo('password_then_recovery', 'replace')).toBe('replace')
    expect(recoveryOperationForCombo('reset_recovery_then_password', 'replace')).toBe('add')
  })

  it('preserves partial success instead of rolling a completed stage back', () => {
    const plan = emailComboStagePlan('password_then_recovery')
    const afterPassword = advanceEmailComboStage(0, 'success', plan.length)
    expect(afterPassword).toEqual({ nextStageIndex: 1, awaitingManual: false, stopped: false, completed: false })

    const recoveryReview = advanceEmailComboStage(afterPassword.nextStageIndex, 'needs_attention', plan.length)
    expect(recoveryReview.nextStageIndex).toBe(1)
    expect(recoveryReview.awaitingManual).toBe(true)
    expect(recoveryReview.completed).toBe(false)
  })

  it('continues the exact manual stage and only advances after success', () => {
    const plan = emailComboStagePlan('reset_recovery_then_password')
    const waiting = advanceEmailComboStage(0, 'needs_attention', plan.length)
    expect(plan[waiting.nextStageIndex]).toBe('recovery_remove')

    const confirmed = advanceEmailComboStage(waiting.nextStageIndex, 'success', plan.length)
    expect(plan[confirmed.nextStageIndex]).toBe('recovery_write')
  })

  it('redacts password, token, code and proxy secrets from public messages', () => {
    const secrets = ['NewPass!123', 'refresh-token-secret', '938221', 'proxy-password']
    const raw = `password=NewPass!123 token=refresh-token-secret code=938221 proxy=proxy-password`
    const safe = redactEmailComboSecrets(raw, secrets)
    for (const secret of secrets) expect(safe).not.toContain(secret)
    expect(safe.match(/\[REDACTED\]/g)).toHaveLength(4)
  })
})
