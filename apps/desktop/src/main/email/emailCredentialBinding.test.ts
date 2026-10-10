import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildEmailLoginPayload,
  emailCredentialFingerprint,
  emailCredentialValueMatches,
  traceEmailCredential
} from './emailCredentialBinding'

describe('Email credential per-account binding', () => {
  const previousTrace = process.env.PAGE_AUTO_EMAIL_CREDENTIAL_TRACE

  afterEach(() => {
    if (previousTrace === undefined) delete process.env.PAGE_AUTO_EMAIL_CREDENTIAL_TRACE
    else process.env.PAGE_AUTO_EMAIL_CREDENTIAL_TRACE = previousTrace
    vi.restoreAllMocks()
  })

  it('keeps two accounts with different PassEmail values distinct', () => {
    const a = buildEmailLoginPayload({
      email: 'alpha@example.com',
      emailPassword: 'mail-secret-alpha',
      backupEmail: null
    })
    const b = buildEmailLoginPayload({
      email: 'beta@example.com',
      emailPassword: 'mail-secret-beta',
      backupEmail: null
    })

    expect(a.loginPassword).toBe('mail-secret-alpha')
    expect(b.loginPassword).toBe('mail-secret-beta')
    expect(a.loginPassword).not.toBe(b.loginPassword)
  })

  it('rebuilds the payload from the latest canonical PassEmail instead of retaining a stale value', () => {
    const account = {
      email: 'same@example.com',
      emailPassword: 'old-mail-secret',
      backupEmail: null
    }
    expect(buildEmailLoginPayload(account).loginPassword).toBe('old-mail-secret')

    account.emailPassword = 'fresh-mail-secret'
    expect(buildEmailLoginPayload(account).loginPassword).toBe('fresh-mail-secret')
  })

  it('compares the actual DOM value against the command credential exactly', () => {
    expect(emailCredentialValueMatches('mail-secret-a', 'mail-secret-a')).toBe(true)
    expect(emailCredentialValueMatches('mail-secret-a', 'mail-secret-b')).toBe(false)
  })

  it('emits only length/fingerprint diagnostics and never plaintext secrets', () => {
    process.env.PAGE_AUTO_EMAIL_CREDENTIAL_TRACE = '1'
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const secret = 'never-print-this-secret'

    traceEmailCredential('test-boundary', {
      accountId: 12,
      uid: '100012',
      email: 'alpha@example.com',
      secret,
      profileDirectory: 'C:\\EmailProfiles\\100012'
    })

    const output = info.mock.calls.flat().join(' ')
    const expected = emailCredentialFingerprint(secret)
    expect(output).toContain('boundary=test-boundary')
    expect(output).toContain('accountId=12')
    expect(output).toContain(`passLen=${expected.length}`)
    expect(output).toContain(`passFp=${expected.fingerprint}`)
    expect(output).toContain('email=a***@example.com')
    expect(output).not.toContain(secret)
  })
})
