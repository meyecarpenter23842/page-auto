import type { LogLevel } from '../../shared/appSettings'
import type { ExecuteSinglePostingJobResult } from '../../shared/posting'

export function shouldPersistPostingAttempt(
  level: LogLevel,
  outcome: ExecuteSinglePostingJobResult,
  willRetry: boolean
): boolean {
  if (level === 'debug') return true
  if (level === 'error') return outcome.result.status === 'failed' || outcome.result.status === 'needs_login'
  return !willRetry
}
