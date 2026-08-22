import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type LogLevel = 'info' | 'warn' | 'error'

const sensitiveKeyPattern = /(password|cookie|2fa|secret|token|proxy.?pass)/i

function sanitizeValue(value: unknown, key = ''): unknown {
  if (sensitiveKeyPattern.test(key)) {
    return '[REDACTED]'
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeValue(childValue, childKey)
      ])
    )
  }

  return value
}

export function createLogger(logFile: string) {
  mkdirSync(dirname(logFile), { recursive: true })

  const write = (level: LogLevel, message: string, meta?: Record<string, unknown>): void => {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(meta ? { meta: sanitizeValue(meta) } : {})
    }

    appendFileSync(logFile, `${JSON.stringify(entry)}\n`, 'utf8')

    const consoleMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info
    consoleMethod(`[${entry.timestamp}] [${level.toUpperCase()}] ${message}`)
  }

  return {
    info: (message: string, meta?: Record<string, unknown>) => write('info', message, meta),
    warn: (message: string, meta?: Record<string, unknown>) => write('warn', message, meta),
    error: (message: string, meta?: Record<string, unknown>) => write('error', message, meta)
  }
}
