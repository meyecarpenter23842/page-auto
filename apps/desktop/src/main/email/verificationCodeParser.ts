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

function candidatesFromMessage(message: MailMessageSnapshot): string[] {
  const text = `${message.subject}\n${message.bodyPreview}\n${message.bodyText}`
  const numeric = Array.from(text.matchAll(NUMERIC_CODE), (match) => match[1]).filter((value): value is string => Boolean(value))
  if (numeric.length > 0) return numeric

  if (KEYWORDS.some((keyword) => text.toLowerCase().includes(keyword))) {
    return Array.from(text.toUpperCase().matchAll(ALPHANUMERIC_CODE), (match) => match[1])
      .filter((value): value is string => typeof value === 'string')
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
