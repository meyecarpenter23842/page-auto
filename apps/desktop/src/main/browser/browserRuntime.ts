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

export function buildBrowserLaunchOptions(
  settings: BrowserSettings,
  placement: BrowserWindowPlacement | null = null
): BrowserLaunchShape {
  const executablePath = settings.executablePath?.trim()
  const args = placement
    ? [
        `--window-size=${placement.width},${placement.height}`,
        `--window-position=${placement.x},${placement.y}`,
        `--force-device-scale-factor=${placement.contentScale}`,
        '--high-dpi-support=1'
      ]
    : [`--window-size=${settings.windowWidth},${settings.windowHeight}`]

  if (settings.mode === 'minimized') args.push('--start-minimized')
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
 * Compact mode keeps the Facebook layout at the configured desktop viewport while
 * the real Chrome window is physically tiled much smaller. deviceScaleFactor makes
 * the rendered page shrink with the window instead of exposing only a cropped corner.
 */
export async function applyBrowserWindowPlacement(
  context: BrowserContext,
  page: Page,
  placement: BrowserWindowPlacement | null
): Promise<void> {
  const session = await context.newCDPSession(page)
  try {
    if (!placement) {
      await session.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined)
      return
    }

    const targetWindow = await session.send('Browser.getWindowForTarget').catch(() => null) as { windowId?: number } | null
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

    await session.send('Emulation.setDeviceMetricsOverride', {
      width: placement.viewportWidth,
      height: placement.viewportHeight,
      deviceScaleFactor: placement.contentScale,
      mobile: false,
      screenWidth: placement.viewportWidth,
      screenHeight: placement.viewportHeight,
      positionX: 0,
      positionY: 0
    })
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
