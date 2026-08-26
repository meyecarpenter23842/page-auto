import { describe, expect, it } from 'vitest'
import {
  canonicalBackupEmailAfterRecoverySuccess,
  normalizeRecoveryEmail,
  validateRecoveryAction
} from './emailAccountActionPolicy'

describe('email recovery action policy', () => {
  it('normalizes recovery email before passing it to the account action', () => {
    expect(normalizeRecoveryEmail('  Recovery@Example.COM  ')).toBe('recovery@example.com')
    expect(normalizeRecoveryEmail('   ')).toBeNull()
  })

  it('requires a valid target for add and replace but not remove', () => {
    expect(() => validateRecoveryAction('add', '')).toThrow('Nhập Email khôi phục mới')
    expect(() => validateRecoveryAction('replace', 'not-an-email')).toThrow('không đúng định dạng')
    expect(validateRecoveryAction('add', 'Next@Example.com')).toBe('next@example.com')
    expect(validateRecoveryAction('remove', undefined)).toBeNull()
  })

  it('updates canonical BackupEmail only from a successful operation result', () => {
    expect(canonicalBackupEmailAfterRecoverySuccess('add', 'new@example.com')).toBe('new@example.com')
    expect(canonicalBackupEmailAfterRecoverySuccess('replace', 'new@example.com')).toBe('new@example.com')
    expect(canonicalBackupEmailAfterRecoverySuccess('remove', null)).toBeNull()
  })
})
