import { describe, expect, it } from 'vitest'
import { emailOAuthWorkerErrorMessage } from './emailOAuthWorkerError'

describe('emailOAuthWorkerErrorMessage', () => {
  it('keeps the friendly lifecycle message for a real browser startup failure', () => {
    const message = emailOAuthWorkerErrorMessage(
      new Error('browserType.launchPersistentContext: Target page, context or browser has been closed'),
      false
    )

    expect(message).toContain('Browser Email không khởi động được')
  })

  it('does not relabel a Microsoft auth failure after the browser is already running', () => {
    const message = emailOAuthWorkerErrorMessage(
      new Error('Microsoft đang yêu cầu xác minh bảo mật; cần xử lý thủ công.'),
      true
    )

    expect(message).toBe('Microsoft đang yêu cầu xác minh bảo mật; cần xử lý thủ công.')
    expect(message).not.toContain('Browser Email không khởi động được')
  })

  it('preserves a post-launch Playwright closure instead of claiming launch failed', () => {
    const message = emailOAuthWorkerErrorMessage(
      new Error('Target page, context or browser has been closed'),
      true
    )

    expect(message).toBe('Target page, context or browser has been closed')
    expect(message).not.toContain('Browser Email không khởi động được')
  })
})
