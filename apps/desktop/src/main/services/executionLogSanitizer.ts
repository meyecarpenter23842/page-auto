const genericSecretPattern = /((?:password|cookie|2fa|secret|token|proxy[_ .-]?pass(?:word)?)\s*[:=]\s*)([^\s,;]+)/gi

export function redactExecutionText(
  value: string | null | undefined,
  secrets: Array<string | null | undefined>
): string | null {
  if (!value) return null
  let sanitized = value
  for (const secret of secrets) {
    const normalized = secret?.trim()
    if (!normalized) continue
    sanitized = sanitized.split(normalized).join('[REDACTED]')
  }
  return sanitized.replace(genericSecretPattern, '$1[REDACTED]')
}
