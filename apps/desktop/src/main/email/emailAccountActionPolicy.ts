import type { HotmailRecoveryOperation } from '../../shared/hotmail'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeRecoveryEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? ''
  return normalized || null
}

export function validateRecoveryAction(operation: HotmailRecoveryOperation, recoveryEmail: string | null | undefined): string | null {
  const normalized = normalizeRecoveryEmail(recoveryEmail)
  if ((operation === 'add' || operation === 'replace') && !normalized) {
    throw new Error('Nhập Email khôi phục mới trước khi chạy thao tác.')
  }
  if (normalized && !EMAIL_PATTERN.test(normalized)) {
    throw new Error('Email khôi phục không đúng định dạng.')
  }
  return operation === 'remove' ? null : normalized
}

export function canonicalBackupEmailAfterRecoverySuccess(operation: HotmailRecoveryOperation, recoveryEmail: string | null): string | null {
  return operation === 'remove' ? null : recoveryEmail
}
