import { afterEach, describe, expect, it } from 'vitest'
import {
  EMAIL_PROFILE_IN_USE_CACHE_MS,
  configuredEmailBrowserWindowSize,
  friendlyEmailBrowserError,
  isEmailProfileInUseError,
  isEmailProfileInUseOverrideActive,
  normalizeEmailBrowserWindowSize,
  shouldKeepEmailBrowserWorker,
  syncEmailBrowserWindowEnvironment
} from './emailBrowserLifecycle'

const WIDTH_ENV = 'PAGE_AUTO_EMAIL_BROWSER_WINDOW_WIDTH'
const HEIGHT_ENV = 'PAGE_AUTO_EMAIL_BROWSER_WINDOW_HEIGHT'
const previousWidth = process.env[WIDTH_ENV]
const previousHeight = process.env[HEIGHT_ENV]

afterEach(() => {
  if (previousWidth === undefined) delete process.env[WIDTH_ENV]
  else process.env[WIDTH_ENV] = previousWidth
  if (previousHeight === undefined) delete process.env[HEIGHT_ENV]
  else process.env[HEIGHT_ENV] = previousHeight
})

describe('email browser lifecycle errors', () => {
  it('recognizes Chromium profile ownership without deleting lock markers', () => {
    expect(isEmailProfileInUseError('Failed to create a ProcessSingleton for your profile directory.')).toBe(true)
    expect(isEmailProfileInUseError('user data directory is already in use')).toBe(true)
    expect(friendlyEmailBrowserError('Failed to create a ProcessSingleton')).toMatch(/không xóa lock/)
  })

  it('keeps live workers for open sessions and manual login attention', () => {
    expect(shouldKeepEmailBrowserWorker('started')).toBe(true)
    expect(shouldKeepEmailBrowserWorker('already_open')).toBe(true)
    expect(shouldKeepEmailBrowserWorker('needs_attention')).toBe(true)
    expect(shouldKeepEmailBrowserWorker('profile_in_use')).toBe(false)
    expect(shouldKeepEmailBrowserWorker('error')).toBe(false)
  })

  it('expires cached profile ownership instead of keeping Đang sử dụng forever', () => {
    const now = 10_000
    expect(isEmailProfileInUseOverrideActive(now + EMAIL_PROFILE_IN_USE_CACHE_MS, now)).toBe(true)
    expect(isEmailProfileInUseOverrideActive(now, now)).toBe(false)
    expect(isEmailProfileInUseOverrideActive(undefined, now)).toBe(false)
  })

  it('keeps browser and proxy errors sanitized', () => {
    expect(friendlyEmailBrowserError('ENOENT chrome.exe')).toMatch(/Không tìm thấy/)
    expect(friendlyEmailBrowserError('net::ERR_PROXY_CONNECTION_FAILED')).toMatch(/Proxy Email/)
  })

  it('normalizes Email-owned browser size independently from Facebook settings', () => {
    expect(normalizeEmailBrowserWindowSize('bad', 100)).toEqual({ width: 1280, height: 800 })
    expect(normalizeEmailBrowserWindowSize(640, 480)).toEqual({ width: 640, height: 480 })
    expect(normalizeEmailBrowserWindowSize(7680, 4320)).toEqual({ width: 7680, height: 4320 })
  })

  it('syncs Email browser size through the worker environment', () => {
    expect(syncEmailBrowserWindowEnvironment({ width: 1111, height: 777 })).toEqual({ width: 1111, height: 777 })
    expect(configuredEmailBrowserWindowSize()).toEqual({ width: 1111, height: 777 })
  })
})
