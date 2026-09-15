import '../browser/browserRuntime'
import { chromium, type Browser, type BrowserContext } from 'playwright-core'
import type { BrowserWindowPlacement } from '../../shared/browserWindowLayout'
import {
  DEFAULT_EMAIL_BROWSER_WINDOW_HEIGHT,
  DEFAULT_EMAIL_BROWSER_WINDOW_WIDTH,
  MAX_EMAIL_BROWSER_WINDOW_HEIGHT,
  MAX_EMAIL_BROWSER_WINDOW_WIDTH,
  MIN_EMAIL_BROWSER_WINDOW_HEIGHT,
  MIN_EMAIL_BROWSER_WINDOW_WIDTH
} from '../../shared/hotmail'
import { emailPlacementLaunchArgs, EmailWindowPlacementController } from './emailWindowPlacement'

const EMAIL_BROWSER_WINDOW_WIDTH_ENV = 'PAGE_AUTO_EMAIL_BROWSER_WINDOW_WIDTH'
const EMAIL_BROWSER_WINDOW_HEIGHT_ENV = 'PAGE_AUTO_EMAIL_BROWSER_WINDOW_HEIGHT'

export interface EmailBrowserWindowSize {
  width: number
  height: number
}

export interface EmailWindowPlacementMessage {
  type: 'email-window-placement'
  accountId: number
  placement: BrowserWindowPlacement | null
}

export interface EmailWindowDetachedMessage {
  type: 'email-window-detached'
  accountId: number
}

function unwrapMessage(event: unknown): unknown {
  return event && typeof event === 'object' && 'data' in event
    ? (event as { data?: unknown }).data
    : event
}

export function isEmailWindowDetachedMessage(value: unknown): value is EmailWindowDetachedMessage {
  const payload = unwrapMessage(value)
  if (!payload || typeof payload !== 'object') return false
  const candidate = payload as Partial<EmailWindowDetachedMessage>
  return candidate.type === 'email-window-detached'
    && typeof candidate.accountId === 'number'
    && Number.isInteger(candidate.accountId)
    && candidate.accountId > 0
}

function parsePlacementMessage(value: unknown): EmailWindowPlacementMessage | null {
  const payload = unwrapMessage(value)
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as Partial<EmailWindowPlacementMessage>
  if (candidate.type !== 'email-window-placement') return null
  if (typeof candidate.accountId !== 'number' || !Number.isInteger(candidate.accountId) || candidate.accountId <= 0) return null
  if (candidate.placement !== null && (typeof candidate.placement !== 'object' || candidate.placement === undefined)) return null
  return candidate as EmailWindowPlacementMessage
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

let desiredPlacement: BrowserWindowPlacement | null | undefined
let desiredAccountId: number | null = null
const trackedContexts = new Set<BrowserContext>()
const placementControllers = new WeakMap<BrowserContext, EmailWindowPlacementController>()

function fallbackWindowArgs(args: readonly string[] | undefined, size: EmailBrowserWindowSize): string[] {
  const current = [...(args ?? [])]
  if (current.some((arg) => arg.startsWith('--window-size='))) return current
  return [...current, `--window-size=${size.width},${size.height}`]
}

function compactWindowArgs(args: readonly string[] | undefined, placement: BrowserWindowPlacement): string[] {
  const current = [...(args ?? [])].filter((arg) =>
    !arg.startsWith('--window-size=')
    && !arg.startsWith('--window-position=')
    && !arg.startsWith('--force-device-scale-factor=')
  )
  return [...current, ...emailPlacementLaunchArgs(placement)]
}

function controllerForContext(context: BrowserContext, launched: boolean): EmailWindowPlacementController {
  const existing = placementControllers.get(context)
  if (existing) return existing

  const controller = new EmailWindowPlacementController(() => {
    const accountId = desiredAccountId
    if (!accountId) return
    const message: EmailWindowDetachedMessage = { type: 'email-window-detached', accountId }
    try {
      process.parentPort?.postMessage(message)
    } catch {
      // Worker lifecycle will release the slot when the browser closes if Main disappeared.
    }
  })
  if (launched) controller.prepareLaunch(desiredPlacement ?? null)
  else controller.adoptAttachedPlacement(desiredPlacement ?? null)
  placementControllers.set(context, controller)
  trackedContexts.add(context)
  context.once('close', () => {
    controller.clear()
    trackedContexts.delete(context)
  })
  context.on('page', (page) => {
    void controller.applyToNewPage(context, page).catch(() => undefined)
  })
  return controller
}

async function applyDesiredPlacement(context: BrowserContext, launched: boolean): Promise<void> {
  const controller = controllerForContext(context, launched)
  await controller.apply(context, desiredPlacement ?? null).catch(() => undefined)
}

/**
 * Legacy/non-Compact fallback. When this worker owns a Compact placement, callers such
 * as EmailPageRegistry must not resize it back to the old global width/height.
 */
export async function applyConfiguredEmailBrowserWindowSize(context: BrowserContext): Promise<void> {
  if (desiredPlacement !== undefined) return
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
  const parentPort = process.parentPort
  if (!parentPort) return

  parentPort.on('message', (event) => {
    const message = parsePlacementMessage(event)
    if (!message) return
    desiredAccountId = message.accountId
    desiredPlacement = message.placement
    for (const context of trackedContexts) {
      const controller = placementControllers.get(context)
      if (!controller) continue
      void controller.forceRetile(context, message.placement).catch(() => undefined)
    }
  })

  const originalLaunchPersistentContext = chromium.launchPersistentContext.bind(chromium)
  const originalConnectOverCDP = chromium.connectOverCDP.bind(chromium) as unknown as (...args: unknown[]) => Promise<Browser>

  const launchPersistentContextWithEmailPlacement: typeof chromium.launchPersistentContext = async (userDataDir, options) => {
    const size = configuredEmailBrowserWindowSize()
    const args = desiredPlacement
      ? compactWindowArgs(options?.args, desiredPlacement)
      : fallbackWindowArgs(options?.args, size)
    const context = await originalLaunchPersistentContext(userDataDir, { ...options, args })
    await applyDesiredPlacement(context, true)
    return context
  }

  const connectOverCDPWithEmailPlacement = (async (...args: unknown[]) => {
    const browser = await originalConnectOverCDP(...args)
    for (const context of browser.contexts()) {
      await applyDesiredPlacement(context, false)
    }
    return browser
  }) as unknown as typeof chromium.connectOverCDP

  Object.defineProperty(chromium, 'launchPersistentContext', {
    configurable: true,
    value: launchPersistentContextWithEmailPlacement
  })
  Object.defineProperty(chromium, 'connectOverCDP', {
    configurable: true,
    value: connectOverCDPWithEmailPlacement
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
