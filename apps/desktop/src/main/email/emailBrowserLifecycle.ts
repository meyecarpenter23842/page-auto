import '../browser/browserRuntime'
import { chromium, type Browser, type BrowserContext } from 'playwright-core'
import {
  DEFAULT_EMAIL_BROWSER_WINDOW_HEIGHT,
  DEFAULT_EMAIL_BROWSER_WINDOW_WIDTH,
  MAX_EMAIL_BROWSER_WINDOW_HEIGHT,
  MAX_EMAIL_BROWSER_WINDOW_WIDTH,
  MIN_EMAIL_BROWSER_WINDOW_HEIGHT,
  MIN_EMAIL_BROWSER_WINDOW_WIDTH
} from '../../shared/hotmail'

const EMAIL_BROWSER_WINDOW_WIDTH_ENV = 'PAGE_AUTO_EMAIL_BROWSER_WINDOW_WIDTH'
const EMAIL_BROWSER_WINDOW_HEIGHT_ENV = 'PAGE_AUTO_EMAIL_BROWSER_WINDOW_HEIGHT'

export interface EmailBrowserWindowSize {
  width: number
  height: number
}

function normalizeDimension(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback
}

export function normalizeEmailBrowserWindowSize(width: unknown, height: unknown): EmailBrowserWindowSize {
  return {
    width: normalizeDimension(
      width,
      DEFAULT_EMAIL_BROWSER_WINDOW_WIDTH,
      MIN_EMAIL_BROWSER_WINDOW_WIDTH,
      MAX_EMAIL_BROWSER_WINDOW_WIDTH
    ),
    height: normalizeDimension(
      height,
      DEFAULT_EMAIL_BROWSER_WINDOW_HEIGHT,
      MIN_EMAIL_BROWSER_WINDOW_HEIGHT,
      MAX_EMAIL_BROWSER_WINDOW_HEIGHT
    )
  }
}

export function syncEmailBrowserWindowEnvironment(size: EmailBrowserWindowSize): EmailBrowserWindowSize {
  const normalized = normalizeEmailBrowserWindowSize(size.width, size.height)
  process.env[EMAIL_BROWSER_WINDOW_WIDTH_ENV] = String(normalized.width)
  process.env[EMAIL_BROWSER_WINDOW_HEIGHT_ENV] = String(normalized.height)
  return normalized
}

export function configuredEmailBrowserWindowSize(): EmailBrowserWindowSize {
  return normalizeEmailBrowserWindowSize(
    process.env[EMAIL_BROWSER_WINDOW_WIDTH_ENV],
    process.env[EMAIL_BROWSER_WINDOW_HEIGHT_ENV]
  )
}

/**
 * Preserve an explicit Compact `--window-size` supplied by an Email worker.
 * The environment size is only the non-Compact fallback for OAuth/manual workers.
 */
function withEmailBrowserWindowArg(args: readonly string[] | undefined, size: EmailBrowserWindowSize): string[] {
  const current = [...(args ?? [])]
  if (current.some((arg) => arg.startsWith('--window-size='))) return current
  return [...current, `--window-size=${size.width},${size.height}`]
}

export async function applyConfiguredEmailBrowserWindowSize(context: BrowserContext): Promise<void> {
  const size = configuredEmailBrowserWindowSize()
  const page = context.pages().find((candidate) => !candidate.isClosed())
  if (!page) return

  const session = await context.newCDPSession(page).catch(() => null)
  if (!session) return
  try {
    const targetWindow = await session.send('Browser.getWindowForTarget').catch(() => null) as { windowId?: number } | null
    if (targetWindow?.windowId === undefined) return
    await session.send('Browser.setWindowBounds', {
      windowId: targetWindow.windowId,
      bounds: {
        width: size.width,
        height: size.height,
        windowState: 'normal'
      }
    }).catch(() => undefined)
  } finally {
    await session.detach().catch(() => undefined)
  }
}

function installEmailBrowserWindowPolicy(): void {
  if (!process.parentPort) return

  const originalLaunchPersistentContext = chromium.launchPersistentContext.bind(chromium)
  const originalConnectOverCDP = chromium.connectOverCDP.bind(chromium) as unknown as (...args: unknown[]) => Promise<Browser>

  const launchPersistentContextWithEmailSize: typeof chromium.launchPersistentContext = async (userDataDir, options) => {
    const size = configuredEmailBrowserWindowSize()
    return await originalLaunchPersistentContext(userDataDir, {
      ...options,
      args: withEmailBrowserWindowArg(options?.args, size)
    })
  }

  // CDP attach must not resize the browser implicitly: a live Email Compact slot is
  // owned by Main and the worker will explicitly re-apply its placement after attach.
  const connectOverCDPWithoutImplicitResize = (async (...args: unknown[]) => {
    return await originalConnectOverCDP(...args)
  }) as unknown as typeof chromium.connectOverCDP

  Object.defineProperty(chromium, 'launchPersistentContext', {
    configurable: true,
    value: launchPersistentContextWithEmailSize
  })
  Object.defineProperty(chromium, 'connectOverCDP', {
    configurable: true,
    value: connectOverCDPWithoutImplicitResize
  })
}

installEmailBrowserWindowPolicy()

export function isEmailProfileInUseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /processsingleton|singletonlock|user data directory.*(in use|already)|profile.*(in use|already)|opening in existing browser session|another browser process/i.test(message)
}

export function friendlyEmailBrowserError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (isEmailProfileInUseError(message)) {
    return 'Profile Email đang được process khác sử dụng; PAGE-AUTO không xóa lock hoặc mở bản sao.'
  }
  if (/executable.*(doesn.t exist|not found)|enoent/i.test(message)) {
    return 'Không tìm thấy file Browser Email đã cấu hình.'
  }
  if (/proxy|tunnel|err_proxy|err_tunnel/i.test(message)) {
    return 'Proxy Email không kết nối được khi mở browser.'
  }
  if (/browser context|connectovercdp|cdp/i.test(message)) {
    return 'Browser Email đang chạy nhưng PAGE-AUTO không attach được qua CDP.'
  }
  return 'Browser Email không khởi động được. Hãy chọn Chrome/Edge/Chromium khác trong Cài đặt Email rồi thử lại.'
}

export function shouldKeepEmailBrowserWorker(status: 'started' | 'already_open' | 'needs_attention' | 'profile_in_use' | 'error'): boolean {
  return status === 'started' || status === 'already_open' || status === 'needs_attention'
}

export const EMAIL_PROFILE_IN_USE_CACHE_MS = 5_000

export function isEmailProfileInUseOverrideActive(expiresAt: number | undefined, now = Date.now()): boolean {
  return typeof expiresAt === 'number' && expiresAt > now
}
