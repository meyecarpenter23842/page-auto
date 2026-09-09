import { describe, expect, it } from 'vitest'
import {
  emailDiagnosticFingerprint,
  redactEmailDiagnosticText
} from './emailRuntimeDiagnostic'

describe('Email runtime diagnostic safety', () => {
  it('redacts email addresses and 4-8 digit code-like values while preserving timing text', () => {
    const value = redactEmailDiagnosticText(
      'Microsoft account team owner123@fivermail.com Security code 481726 0 secs ago'
    )
    expect(value).toContain('<email>')
    expect(value).toContain('<digits:6>')
    expect(value).toContain('0 secs ago')
    expect(value).not.toContain('481726')
    expect(value).not.toContain('owner123@fivermail.com')
  })

  it('uses stable short fingerprints without exposing the source value', () => {
    const fingerprint = emailDiagnosticFingerprint('message-key-secret')
    expect(fingerprint).toMatch(/^[a-f0-9]{12}$/)
    expect(fingerprint).not.toContain('message-key-secret')
  })
})
