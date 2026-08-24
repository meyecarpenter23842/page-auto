import type { BrowserContext, CDPSession, Page } from 'playwright-core'
import type { BrowserSettings } from '../../shared/appSettings'
import type { BrowserWindowPlacement } from '../../shared/browserWindowLayout'

export interface BrowserLaunchShape {
  headless: false
  args: string[]
  timeout: number
  executablePath?: string
  channel?: 'chrome'
}

export interface CompactDeviceMetrics {
  width: number
  height: number
  deviceScaleFactor: number
  mobile: false
  screenWidth: number
  screenHeight: number
  scale: number
}

export interface CompactViewportFit {
  width: number
  height: number
  scale: number
}

const MIN_COMPACT_SCALE = 0.001
const compactSessions = new WeakMap<Page, CDPSession>()

async function compactSessionFor(context: BrowserContext, page: Page): Promise<CDPSession> {
  const existing = compactSessions.get(page)
  if (existing) return existing

  const session = await context.newCDPSession(page)
  compactSessions.set(page, session)
  page.once('close', () => {
    if (compactSessions.get(page) !== session) return
    compactSessions.delete(page)
    void session.detach().catch(() => undefined)
  })
  return session
}

async function releaseCompactSession(page: Page, session: CDPSession): Promise<void> {
  if (compactSessions.get(page) === session) compactSessions.delete(page)
  await session.detach().catch(() => undefined)
}

export function effectiveCompactContentScale(
  placement: BrowserWindowPlacement,
  innerWidth: number,
  innerHeight: number
): number {
  const widthScale = Math.max(1, innerWidth) / Math.max(1, placement.viewportWidth)
  const heightScale = Math.max(1, innerHeight) / Math.max(1, placement.viewportHeight)
  const scale = Math.min(1, widthScale, heightScale)
  return Math.max(MIN_COMPACT_SCALE, Math.round(scale * 1000) / 1000)
}

/**
 * Keep at least the configured desktop viewport, but expand the logical viewport on
 * the axis that would otherwise leave empty letterbox space. This makes the rendered
 * Facebook page fill the real Chrome content area while preserving desktop breakpoints.
 */
export function fitCompactViewportToInnerArea(
  placement: BrowserWindowPlacement,
  innerWidth: number,
  innerHeight: number
): CompactViewportFit {
  const safeInnerWidth = Math.max(1, innerWidth)
  const safeInnerHeight = Math.max(1, innerHeight)
  const scale = effectiveCompactContentScale(placement, safeInnerWidth, safeInnerHeight)
  return {
    width: Math.max(placement.viewportWidth, Math.round(safeInnerWidth / scale)),
    height: Math.max(placement.viewportHeight, Math.round(safeInnerHeight / scale)),
    scale
  }
}

export function compactDeviceMetrics(
  placement: BrowserWindowPlacement,
  actualScale: number = placement.contentScale,
  viewportWidth: number = placement.viewportWidth,
  viewportHeight: number = placement.viewportHeight
): CompactDeviceMetrics {
  return {
    width: viewportWidth,
    height: viewportHeight,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: viewportWidth,
    screenHeight: viewportHeight,
    scale: actualScale
  }
}

export function buildBrowserLaunchOptions(
  settings: BrowserSettings,
  placement: BrowserWindowPlacement | null = null
): BrowserLaunchShape {
  const executablePath = settings.executablePath?.trim()
  const args = placement
    ? [
        `--window-size=${placement.width},${placement.height}`,
        `--window-position=${placement.x},${placement.y}`
      ]
    : [`--window-size=${settings.windowWidth},${settings.windowHeight}`]

  if (!placement && settings.mode === 'minimized') args.push('--start-minimized')
  if (settings.muteAudio) args.push('--mute-audio')
  if (settings.disableGpu) args.push('--disable-gpu')

  return {
    headless: false,
    args,
    timeout: settings.startupTimeoutMs,
    ...(executablePath ? { executablePath } : { channel: 'chrome' as const })
  }
}

export async function applyBrowserContextSettings(
  context: BrowserContext,
  settings: BrowserSettings
): Promise<void> {
  context.setDefaultNavigationTimeout(settings.navigationTimeoutMs)
  context.setDefaultTimeout(settings.navigationTimeoutMs)

  if (settings.disableImageLoading) {
    await context.route('**/*', async (route) => {
      if (route.request().resourceType() === 'image') {
        await route.abort().catch(() => undefined)
        return
      }
      await route.continue().catch(() => undefined)
    })
  }
}

/**
 * Compact mode keeps a desktop-class logical viewport while the real Chrome window
 * is physically smaller. The CDP session stays attached while device emulation is
 * active. The logical viewport is expanded to the real content-area aspect ratio so
 * the page fills the tile instead of leaving a large blank strip.
 */
export async function applyBrowserWindowPlacement(
  context: BrowserContext,
  page: Page,
  placement: BrowserWindowPlacement | null
): Promise<void> {
  const session = await compactSessionFor(context, page)
  const targetWindow = await session.send('Browser.getWindowForTarget').catch(() => null) as { windowId?: number } | null

  if (!placement) {
    await session.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined)
    if (targetWindow?.windowId !== undefined) {
      await session.send('Browser.setWindowBounds', {
        windowId: targetWindow.windowId,
        bounds: { windowState: 'normal' }
      }).catch(() => undefined)
    }
    await releaseCompactSession(page, session)
    return
  }

  await session.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined)

  if (targetWindow?.windowId !== undefined) {
    await session.send('Browser.setWindowBounds', {
      windowId: targetWindow.windowId,
      bounds: {
        left: placement.x,
        top: placement.y,
        width: placement.width,
        height: placement.height,
        windowState: 'normal'
      }
    }).catch(() => undefined)
  }

  await page.waitForTimeout(60).catch(() => undefined)
  const inner = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  })).catch(() => ({ width: placement.width, height: placement.height }))
  const fit = fitCompactViewportToInnerArea(placement, inner.width, inner.height)

  await session.send(
    'Emulation.setDeviceMetricsOverride',
    compactDeviceMetrics(placement, fit.scale, fit.width, fit.height)
  )
}

export async function applyBrowserPlacementToContext(
  context: BrowserContext,
  placement: BrowserWindowPlacement | null
): Promise<void> {
  for (const page of context.pages()) {
    await applyBrowserWindowPlacement(context, page, placement).catch(() => undefined)
  }
}

export async function waitForBrowserStartupDelay(settings: BrowserSettings): Promise<void> {
  if (settings.startupDelayMs <= 0) return
  await new Promise<void>((resolve) => setTimeout(resolve, settings.startupDelayMs))
}
