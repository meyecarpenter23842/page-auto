import type { BrowserContext } from 'playwright-core'
import type { BrowserSettings } from '../../shared/appSettings'

export interface BrowserLaunchShape {
  headless: false
  args: string[]
  timeout: number
  executablePath?: string
  channel?: 'chrome'
}

export function buildBrowserLaunchOptions(settings: BrowserSettings): BrowserLaunchShape {
  const executablePath = settings.executablePath?.trim()
  const args = [`--window-size=${settings.windowWidth},${settings.windowHeight}`]

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

export async function waitForBrowserStartupDelay(settings: BrowserSettings): Promise<void> {
  if (settings.startupDelayMs <= 0) return
  await new Promise<void>((resolve) => setTimeout(resolve, settings.startupDelayMs))
}
