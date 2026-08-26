import { describe, expect, it } from 'vitest'
import { friendlyEmailBrowserError, isEmailProfileInUseError, shouldKeepEmailBrowserWorker } from './emailBrowserLifecycle'

describe('email browser lifecycle errors', () => {
  it('recognizes Chromium profile ownership without deleting lock markers', () => {
    expect(isEmailProfileInUseError('Failed to create a ProcessSingleton for your profile directory.')).toBe(true)
    expect(isEmailProfileInUseError('user data directory is already in use')).toBe(true)
    expect(friendlyEmailBrowserError('Failed to create a ProcessSingleton')).toMatch(/không xóa lock/)
  })

  it('drops idle utility workers after terminal open failures', () => {
    expect(shouldKeepEmailBrowserWorker('started')).toBe(true)
    expect(shouldKeepEmailBrowserWorker('already_open')).toBe(true)
    expect(shouldKeepEmailBrowserWorker('profile_in_use')).toBe(false)
    expect(shouldKeepEmailBrowserWorker('error')).toBe(false)
  })

  it('keeps browser and proxy errors sanitized', () => {
    expect(friendlyEmailBrowserError('ENOENT chrome.exe')).toMatch(/Không tìm thấy/)
    expect(friendlyEmailBrowserError('net::ERR_PROXY_CONNECTION_FAILED')).toMatch(/Proxy Email/)
  })
})
