export interface MailCandidate {
  id: string
  sender: string
  subject: string
  receivedAt: number
  body: string
}

export interface VerificationCodeMatch {
  code: string
  messageId: string
  sender: string
  subject: string
  receivedAt: number
  score: number
}

const contextPatterns = [
  /(?:verification|security|login|sign[ -]?in|one[ -]?time|passcode|otp|code|mã|xác minh)[^0-9]{0,36}([0-9]{4,8})/gi,
  /([0-9]{4,8})[^a-z0-9]{0,18}(?:verification|security|login|sign[ -]?in|one[ -]?time|passcode|otp|code|mã|xác minh)/gi
]

function keywordScore(value: string): number {
  const normalized = value.toLowerCase()
  let score = 0
  if (/verification|security|login|sign[ -]?in|one[ -]?time|passcode|otp|code|xác minh|mã/.test(normalized)) score += 4
  if (/microsoft|outlook|facebook|meta|instagram|account|support|security/.test(normalized)) score += 2
  return score
}

function findCodes(text: string): Array<{ code: string; contextual: boolean }> {
  const matches: Array<{ code: string; contextual: boolean }> = []
  const seen = new Set<string>()

  for (const pattern of contextPatterns) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const code = match[1]
      if (!code || seen.has(code)) continue
      seen.add(code)
      matches.push({ code, contextual: true })
    }
  }

  const standalone = text.match(/\b[0-9]{6}\b/g) ?? []
  for (const code of standalone) {
    if (seen.has(code)) continue
    seen.add(code)
    matches.push({ code, contextual: false })
  }

  return matches
}

export function parseVerificationCode(
  messages: MailCandidate[],
  now = Date.now(),
  maxAgeMs = 24 * 60 * 60 * 1000
): VerificationCodeMatch | null {
  const candidates: VerificationCodeMatch[] = []

  for (const message of messages) {
    if (!Number.isFinite(message.receivedAt) || now - message.receivedAt > maxAgeMs) continue
    const combined = `${message.subject}\n${message.body}`
    const codes = findCodes(combined)
    for (const codeMatch of codes) {
      const ageMinutes = Math.max(0, (now - message.receivedAt) / 60_000)
      const recencyScore = Math.max(0, 4 - ageMinutes / 30)
      const score = keywordScore(message.subject)
        + keywordScore(message.sender)
        + (codeMatch.contextual ? 5 : 1)
        + recencyScore
      candidates.push({
        code: codeMatch.code,
        messageId: message.id,
        sender: message.sender,
        subject: message.subject,
        receivedAt: message.receivedAt,
        score
      })
    }
  }

  candidates.sort((left, right) => right.score - left.score || right.receivedAt - left.receivedAt)
  return candidates[0] ?? null
}
