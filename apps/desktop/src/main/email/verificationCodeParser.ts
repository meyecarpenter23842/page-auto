export interface MailMessageSnapshot {
  id: string
  receivedAt: number
  sender: string
  subject: string
  bodyPreview: string
  bodyText: string
}

export interface VerificationCodeMatch {
  code: string
  messageId: string
  receivedAt: number
  sender: string
  subject: string
  score: number
}

const KEYWORDS = [
  'verification code',
  'security code',
  'one-time code',
  'one time code',
  'otp',
  'mã xác minh',
  'mã bảo mật',
  'mã đăng nhập',
  'confirm',
  'verify'
]

const EMAIL_ADDRESS = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
const LABELLED_NUMERIC_CODE = /(?:verification|security|one[- ]?time|single[- ]?use)\s+code(?:\s+is)?\s*[:#-]?\s*(\d{4,8})|mã\s+(?:xác minh|bảo mật|đăng nhập)(?:\s+là)?\s*[:#-]?\s*(\d{4,8})/gi
const NUMERIC_CODE = /(?<!\d)(\d{4,8})(?!\d)/g
const ALPHANUMERIC_CODE = /\b([A-Z0-9]{6,8})\b/g

function scoreMessage(message: MailMessageSnapshot, now: number): number {
  const text = `${message.sender}\n${message.subject}\n${message.bodyPreview}\n${message.bodyText}`.toLowerCase()
  let score = 0
  for (const keyword of KEYWORDS) {
    if (text.includes(keyword)) score += keyword.includes('code') || keyword.includes('mã') ? 4 : 2
  }
  if (/no[- ]?reply|security|account|support|verify|verification/i.test(message.sender)) score += 1
  const ageMinutes = Math.max(0, (now - message.receivedAt) / 60_000)
  if (ageMinutes <= 10) score += 4
  else if (ageMinutes <= 60) score += 2
  else if (ageMinutes <= 24 * 60) score += 1
  return score
}

function uniqueCodes(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

function candidatesFromMessage(message: MailMessageSnapshot): string[] {
  // Email local-parts can legitimately contain 4-8 digit runs (for example
  // owner37063b2401@fivermail.com). They are identifiers, not OTP candidates.
  const rawText = `${message.subject}\n${message.bodyPreview}\n${message.bodyText}`
  const text = rawText.replace(EMAIL_ADDRESS, ' ')
  const labelled = Array.from(text.matchAll(LABELLED_NUMERIC_CODE), (match) => match[1] ?? match[2])
  const numeric = Array.from(text.matchAll(NUMERIC_CODE), (match) => match[1])
  const numericCandidates = uniqueCodes([...labelled, ...numeric])
  if (numericCandidates.length > 0) return numericCandidates

  if (KEYWORDS.some((keyword) => text.toLowerCase().includes(keyword))) {
    return uniqueCodes(Array.from(text.toUpperCase().matchAll(ALPHANUMERIC_CODE), (match) => match[1]))
      .filter((value) => /\d/.test(value) && /[A-Z]/.test(value))
  }
  return []
}

export function parseVerificationCode(messages: MailMessageSnapshot[], now = Date.now()): VerificationCodeMatch | null {
  const ranked: VerificationCodeMatch[] = []

  for (const message of messages) {
    if (!Number.isFinite(message.receivedAt) || message.receivedAt <= 0 || message.receivedAt > now + 5 * 60_000) continue
    const messageScore = scoreMessage(message, now)
    // A bare order/reference number is not an OTP. Require at least one verification
    // signal from content or sender before considering numeric candidates.
    const text = `${message.sender}\n${message.subject}\n${message.bodyPreview}\n${message.bodyText}`.toLowerCase()
    const hasVerificationSignal = KEYWORDS.some((keyword) => text.includes(keyword))
      || /security|verify|verification/i.test(message.sender)
    if (!hasVerificationSignal || messageScore <= 0) continue
    const codes = candidatesFromMessage(message)
    for (const [index, code] of codes.entries()) {
      if (!code) continue
      ranked.push({
        code,
        messageId: message.id,
        receivedAt: message.receivedAt,
        sender: message.sender,
        subject: message.subject,
        score: messageScore - index
      })
    }
  }

  ranked.sort((left, right) => right.score - left.score || right.receivedAt - left.receivedAt)
  return ranked[0] ?? null
}
