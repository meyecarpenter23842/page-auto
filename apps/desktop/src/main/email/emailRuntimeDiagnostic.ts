import { createHash } from 'node:crypto'
import { appendFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type EmailDiagnosticValue = string | number | boolean | null | undefined
export type EmailDiagnosticFields = Record<string, EmailDiagnosticValue>

const EMAIL_ADDRESS = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
const SENSITIVE_NUMERIC_RUN = /\b\d{4,8}\b/g
const MAX_VALUE_LENGTH = 320
const DIAGNOSTIC_PATH = join(tmpdir(), `page-auto-email-diagnostic-${process.pid}.log`)

let initialized = false
let writeChain = Promise.resolve()

export function emailDiagnosticPath(): string {
  return DIAGNOSTIC_PATH
}

export function redactEmailDiagnosticText(value: string): string {
  return value
    .replace(EMAIL_ADDRESS, '<email>')
    .replace(SENSITIVE_NUMERIC_RUN, (match) => `<digits:${match.length}>`)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_VALUE_LENGTH)
}

export function emailDiagnosticFingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

function formatValue(value: EmailDiagnosticValue): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return JSON.stringify(redactEmailDiagnosticText(value))
  return String(value)
}

function lineFor(scope: string, event: string, fields: EmailDiagnosticFields): string {
  const timestamp = new Date().toISOString()
  const suffix = Object.entries(fields)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(' ')
  return `[${timestamp}] [EMAIL-DIAG] pid=${process.pid} scope=${scope} event=${event}${suffix ? ` ${suffix}` : ''}`
}

export function emailDiagnostic(
  scope: string,
  event: string,
  fields: EmailDiagnosticFields = {}
): void {
  const line = lineFor(scope, event, fields)
  console.info(line)

  if (!initialized) {
    initialized = true
    const header = `[EMAIL-DIAG] PAGE-AUTO safe diagnostic log. Password/cookie/2FA/code plaintext is never written. pid=${process.pid}\n`
    writeChain = writeFile(DIAGNOSTIC_PATH, `${header}${line}\n`, 'utf8').catch(() => undefined)
    return
  }

  writeChain = writeChain
    .then(() => appendFile(DIAGNOSTIC_PATH, `${line}\n`, 'utf8'))
    .catch(() => undefined)
}
