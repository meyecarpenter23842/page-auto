import { describe, expect, it } from 'vitest'
import type { ExecuteSinglePostingJobResult } from '../../shared/posting'
import { shouldPersistPostingAttempt } from './loggingPolicy'

function outcome(status: ExecuteSinglePostingJobResult['result']['status']): ExecuteSinglePostingJobResult {
  return {
    accountId: 1,
    item: null,
    result: { status, message: status },
    run: null as unknown as ExecuteSinglePostingJobResult['run']
  }
}

describe('shouldPersistPostingAttempt', () => {
  it('keeps only failures in error mode', () => {
    expect(shouldPersistPostingAttempt('error', outcome('failed'), true)).toBe(true)
    expect(shouldPersistPostingAttempt('error', outcome('needs_login'), false)).toBe(true)
    expect(shouldPersistPostingAttempt('error', outcome('success'), false)).toBe(false)
    expect(shouldPersistPostingAttempt('error', outcome('skipped'), false)).toBe(false)
  })

  it('keeps terminal logical outcome in normal mode', () => {
    expect(shouldPersistPostingAttempt('normal', outcome('failed'), true)).toBe(false)
    expect(shouldPersistPostingAttempt('normal', outcome('success'), false)).toBe(true)
  })

  it('keeps every attempt in debug mode', () => {
    expect(shouldPersistPostingAttempt('debug', outcome('failed'), true)).toBe(true)
    expect(shouldPersistPostingAttempt('debug', outcome('success'), false)).toBe(true)
  })
})
