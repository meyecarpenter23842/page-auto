import { createHash } from 'node:crypto'
import type { AccountRecord } from '../../shared/accounts'

type EmailCredentialAccount = Pick<AccountRecord, 'email' | 'emailPassword' | 'backupEmail'>

export interface EmailCredentialTraceInput {
  accountId: number
  uid?: string | null | undefined
  email?: string | null | undefined
  secret?: string | null | undefined
  profileDirectory?: string | null | undefined
}

export function buildEmailLoginPayload(account: EmailCredentialAccount) {
  return {
    ...(account.email?.trim() ? { loginEmail: account.email.trim() } : {}),
    ...(account.emailPassword ? { loginPassword: account.emailPassword } : {}),
    ...(account.backupEmail?.trim() ? { backupEmail: account.backupEmail.trim() } : {})
  }
}

export function emailCredentialFingerprint(secret: string | null | undefined): { length: number; fingerprint: string } {
  const value = secret ?? ''
  return {
    length: value.length,
    fingerprint: value ? createHash('sha256').update(value).digest('hex').slice(0, 8) : 'none'
  }
}

export function emailCredentialValueMatches(expected: string, actual: string): boolean {
  return expected === actual
}

function maskEmail(email: string | null | undefined): string {
  const value = email?.trim() ?? ''
  const at = value.indexOf('@')
  if (at <= 0) return value ? `${value.slice(0, 1)}***` : '-'
  return `${value.slice(0, 1)}***${value.slice(at)}`
}

/**
 * Opt-in credential tracing for live diagnostics. Never logs plaintext secrets.
 * Enable only while reproducing with PAGE_AUTO_EMAIL_CREDENTIAL_TRACE=1.
 */
export function traceEmailCredential(boundary: string, input: EmailCredentialTraceInput): void {
  if (process.env.PAGE_AUTO_EMAIL_CREDENTIAL_TRACE !== '1') return
  const { length, fingerprint } = emailCredentialFingerprint(input.secret)
  const uid = input.uid?.trim() || '-'
  const profile = input.profileDirectory?.trim() || '-'
  console.info(
    `[PAGE-AUTO email credential] boundary=${boundary} accountId=${input.accountId} uid=${uid} email=${maskEmail(input.email)} passLen=${length} passFp=${fingerprint} profile=${profile}`
  )
}
