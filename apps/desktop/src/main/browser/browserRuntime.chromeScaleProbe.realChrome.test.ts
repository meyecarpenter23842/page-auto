import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type BrowserContext, type CDPSession } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '../../shared/appSettings'
import { buildBrowserLaunchOptions } from './browserRuntime'

const realChromeDescribe = process.platform === 'win32' && Boolean(process.env.CI)
  ? describe
  : describe.skip

const SCALE_FACTORS = [1, 0.8, 0.67, 0.5, 0.4] as const
const LOGICAL_WIDTH = 1280
const LOGICAL_HEIGHT = 800

interface NativeBounds {
  width: number
  height: number
}

interface PageMetrics {
  devicePixelRatio: number
  outerWidth: number
  outerHeight: number
  innerWidth: number
  innerHeight: number
  screenWidth: number
  screenHeight: number
}

async function stableBounds(session: CDPSession, windowId: number): Promise<NativeBounds> {
  await session.send('Browser.setWindowBounds', {
    windowId,
    bounds: {
      left: 100,
      top: 80,
      width: LOGICAL_WIDTH,
      height: LOGICAL_HEIGHT,
      windowState: 'normal'
    }
  })

  const deadline = Date.now() + 3_000
  let previous: NativeBounds | null = null
  let stableReads = 0
  let latest: NativeBounds = { width: 0, height: 0 }

  while (Date.now() < deadline) {
    const result = await session.send('Browser.getWindowBounds', { windowId }) as {
      bounds: { width?: number; height?: number }
    }
    latest = {
      width: typeof result.bounds.width === 'number' ? result.bounds.width : 0,
      height: typeof result.bounds.height === 'number' ? result.bounds.height : 0
    }
    if (previous && previous.width === latest.width && previous.height === latest.height) {
      stableReads += 1
      if (stableReads >= 2) return latest
    } else {
      stableReads = 0
    }
    previous = latest
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
  }

  return latest
}

realChromeDescribe('Compact whole-Chrome scale probe on Windows', () => {
  it('keeps a desktop logical viewport when scaled Chrome has enough logical screen space', async () => {
    const results: Array<{ requestedScale: number; metrics: PageMetrics; bounds: NativeBounds }> = []

    for (const requestedScale of SCALE_FACTORS) {
      const profileDirectory = await mkdtemp(join(tmpdir(), `page-auto-chrome-scale-${String(requestedScale).replace('.', '-')}-`))
      let context: BrowserContext | null = null
      let session: CDPSession | null = null

      try {
        const launchShape = buildBrowserLaunchOptions({
          ...DEFAULT_APP_SETTINGS.browser,
          executablePath: null,
          windowWidth: LOGICAL_WIDTH,
          windowHeight: LOGICAL_HEIGHT
        })
        context = await chromium.launchPersistentContext(profileDirectory, {
          ...launchShape,
          args: [
            ...launchShape.args,
            `--force-device-scale-factor=${requestedScale}`,
            '--remote-debugging-address=127.0.0.1',
            '--remote-debugging-port=0'
          ],
          viewport: null
        })
        const page = context.pages()[0] ?? await context.newPage()
        await page.goto('about:blank')
        session = await context.newCDPSession(page)
        const target = await session.send('Browser.getWindowForTarget') as { windowId: number }
        const bounds = await stableBounds(session, target.windowId)
        const metrics = await page.evaluate(() => ({
          devicePixelRatio: window.devicePixelRatio,
          outerWidth: window.outerWidth,
          outerHeight: window.outerHeight,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          screenWidth: window.screen.width,
          screenHeight: window.screen.height
        }))

        results.push({ requestedScale, metrics, bounds })
        console.log(
          `[COMPACT_CHROME_SCALE_PROBE] requestedScale=${requestedScale} dpr=${metrics.devicePixelRatio} `
          + `native=${bounds.width}x${bounds.height} outer=${metrics.outerWidth}x${metrics.outerHeight} `
          + `inner=${metrics.innerWidth}x${metrics.innerHeight} screen=${metrics.screenWidth}x${metrics.screenHeight}`
        )

        expect(bounds.width).toBeGreaterThan(0)
        expect(bounds.height).toBeGreaterThan(0)
        expect(metrics.devicePixelRatio).toBeCloseTo(requestedScale, 2)
        expect(metrics.innerWidth).toBeGreaterThan(0)
        expect(metrics.innerHeight).toBeGreaterThan(0)

        const hasDesktopLogicalSpace = metrics.screenWidth >= LOGICAL_WIDTH && metrics.screenHeight >= LOGICAL_HEIGHT
        if (hasDesktopLogicalSpace) {
          expect(bounds.width).toBeGreaterThanOrEqual(LOGICAL_WIDTH - 2)
          expect(bounds.height).toBeGreaterThanOrEqual(LOGICAL_HEIGHT - 2)
          expect(metrics.innerWidth).toBeGreaterThan(1100)
          expect(metrics.innerHeight).toBeGreaterThan(650)
        }
      } finally {
        await session?.detach().catch(() => undefined)
        await context?.close().catch(() => undefined)
        await rm(profileDirectory, { recursive: true, force: true })
      }
    }

    expect(results).toHaveLength(SCALE_FACTORS.length)
    const compactFit = results.find((result) => result.requestedScale === 0.4)
    expect(compactFit).toBeDefined()
    expect(compactFit?.metrics.devicePixelRatio).toBeCloseTo(0.4, 2)
    expect(compactFit?.metrics.innerWidth).toBeGreaterThan(1100)
    expect(compactFit?.metrics.innerHeight).toBeGreaterThan(650)
  }, 90_000)
})
