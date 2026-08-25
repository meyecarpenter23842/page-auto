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

const REQUESTED_SIDES = [500, 450, 400, 350, 300] as const

interface NativeBounds {
  width: number
  height: number
}

async function readBounds(session: CDPSession, windowId: number): Promise<NativeBounds> {
  const result = await session.send('Browser.getWindowBounds', { windowId }) as {
    bounds: { width?: number; height?: number }
  }
  const width = result.bounds.width
  const height = result.bounds.height
  if (typeof width !== 'number' || typeof height !== 'number') {
    throw new Error('Chrome did not return native width/height.')
  }
  return { width, height }
}

async function requestAndReadStableBounds(
  session: CDPSession,
  windowId: number,
  side: number
): Promise<NativeBounds> {
  await session.send('Browser.setWindowBounds', {
    windowId,
    bounds: {
      left: 100,
      top: 80,
      width: side,
      height: side,
      windowState: 'normal'
    }
  })

  const deadline = Date.now() + 3_000
  let previous: NativeBounds | null = null
  let stableReads = 0
  let latest = await readBounds(session, windowId)

  while (Date.now() < deadline) {
    if (previous && previous.width === latest.width && previous.height === latest.height) {
      stableReads += 1
      if (stableReads >= 2) return latest
    } else {
      stableReads = 0
    }
    previous = latest
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
    latest = await readBounds(session, windowId)
  }

  return latest
}

realChromeDescribe('Compact Chrome native minimum probe on Windows', () => {
  it('records requested versus actual native bounds for 500/450/400/350/300 without emulation', async () => {
    const profileDirectory = await mkdtemp(join(tmpdir(), 'page-auto-compact-min-probe-'))
    let context: BrowserContext | null = null
    let session: CDPSession | null = null

    try {
      const launchShape = buildBrowserLaunchOptions({
        ...DEFAULT_APP_SETTINGS.browser,
        executablePath: null,
        windowWidth: 500,
        windowHeight: 500
      })
      context = await chromium.launchPersistentContext(profileDirectory, {
        ...launchShape,
        args: [
          ...launchShape.args,
          '--remote-debugging-address=127.0.0.1',
          '--remote-debugging-port=0'
        ],
        viewport: null
      })
      const page = context.pages()[0] ?? await context.newPage()
      await page.goto('about:blank')
      session = await context.newCDPSession(page)
      const target = await session.send('Browser.getWindowForTarget') as { windowId: number }

      const results: Array<{ requested: number; actual: NativeBounds }> = []
      for (const requested of REQUESTED_SIDES) {
        const actual = await requestAndReadStableBounds(session, target.windowId, requested)
        results.push({ requested, actual })
        const clamped = actual.width !== requested || actual.height !== requested
        console.log(`[COMPACT_NATIVE_PROBE] requested=${requested}x${requested} actual=${actual.width}x${actual.height} clamped=${clamped}`)
        expect(actual.width).toBeGreaterThan(0)
        expect(actual.height).toBeGreaterThan(0)
      }

      expect(results).toHaveLength(REQUESTED_SIDES.length)
    } finally {
      await session?.detach().catch(() => undefined)
      await context?.close().catch(() => undefined)
      await rm(profileDirectory, { recursive: true, force: true })
    }
  }, 30_000)
})
