import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type BrowserContext, type CDPSession } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '../../shared/appSettings'
import { normalizeAutomationProfileZoom } from './automationBrowserVisualContract'
import { buildBrowserLaunchOptions } from './browserRuntime'

const realChromeDescribe = process.platform === 'win32' && Boolean(process.env.CI)
  ? describe
  : describe.skip

async function readPageZoom(session: CDPSession): Promise<number | null> {
  const metrics = await session.send('Page.getLayoutMetrics') as {
    cssVisualViewport?: { zoom?: number }
  }
  const zoom = metrics.cssVisualViewport?.zoom
  return typeof zoom === 'number' && Number.isFinite(zoom) ? zoom : null
}

realChromeDescribe('automation browser visual contract on Windows Chrome', () => {
  it('opens at 100 percent after a persisted non-default profile zoom is normalized before launch', async () => {
    const profileDirectory = await mkdtemp(join(tmpdir(), 'page-auto-visual-contract-'))
    let context: BrowserContext | null = null
    let session: CDPSession | null = null

    try {
      const defaultDirectory = join(profileDirectory, 'Default')
      await mkdir(defaultDirectory, { recursive: true })
      await writeFile(join(defaultDirectory, 'Preferences'), JSON.stringify({
        partition: {
          // Current Chromium default storage-partition key for the profile root is `x`.
          default_zoom_level: { x: 2 },
          per_host_zoom_levels: {
            x: {
              'www.facebook.com': { zoom_level: -1.2239010857415449 }
            }
          }
        }
      }), 'utf8')

      const normalized = await normalizeAutomationProfileZoom(profileDirectory)
      expect(normalized).toEqual({ status: 'normalized', changed: true })

      const launchShape = buildBrowserLaunchOptions({
        ...DEFAULT_APP_SETTINGS.browser,
        executablePath: null,
        windowWidth: 1280,
        windowHeight: 800
      })
      context = await chromium.launchPersistentContext(profileDirectory, {
        ...launchShape,
        viewport: null
      })
      const page = context.pages()[0] ?? await context.newPage()
      await page.goto('data:text/html,<title>visual-contract</title><main>ready</main>')
      session = await context.newCDPSession(page)

      const zoom = await readPageZoom(session)
      expect(zoom).not.toBeNull()
      expect(zoom).toBeCloseTo(1, 2)
    } finally {
      await session?.detach().catch(() => undefined)
      await context?.close().catch(() => undefined)
      await rm(profileDirectory, { recursive: true, force: true })
    }
  }, 45_000)
})
