import type { BrowserContext, Page } from 'playwright-core'
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

export function compactDeviceMetrics(placement: BrowserWindowPlacement): CompactDeviceMetrics {
  return {
    width: placement.viewportWidth,
    height: placement.viewportHeight,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: placement.viewportWidth,
    screenHeight: placement.viewportHeight,
    scale: placement.contentScale
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

  // Compact/tiled windows must stay visible. Minimized applies only to the normal mode.
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
 * Compact mode keeps Facebook on the configured desktop layout viewport while the
 * real Chrome top-level window is physically much smaller. CDP scales the rendered
 * view down to the slot, so the operator sees the whole page at a smaller ratio
 * instead of a large desktop page cropped to one corner.
 */
export async function applyBrowserWindowPlacement(
  context: BrowserContext,
  page: Page,
  placement: BrowserWindowPlacement | null
): Promise<void> {
  const session = await context.newCDPSession(page)
  try {
    const targetWindow = await session.send('Browser.getWindowForTarget').catch(() => null) as { windowId?: number } | null

    if (!placement) {
      await session.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined)
      if (targetWindow?.windowId !== undefined) {
        await session.send('Browser.setWindowBounds', {
          windowId: targetWindow.windowId,
          bounds: { windowState: 'normal' }
        }).catch(() => undefined)
      }
      return
    }

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

    await session.send('Emulation.setDeviceMetricsOverride', compactDeviceMetrics(placement))
  } finally {
    await session.detach().catch(() => undefined)
  }
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
