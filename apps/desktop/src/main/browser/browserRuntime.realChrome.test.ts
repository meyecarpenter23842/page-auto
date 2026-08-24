import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type BrowserContext, type CDPSession } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import type { BrowserWindowPlacement } from '../../shared/browserWindowLayout'
import { applyBrowserWindowPlacement, watchForManualBrowserResize } from './browserRuntime'

const realChromeDescribe = process.platform === 'win32' && Boolean(process.env.CI)
  ? describe
  : describe.skip

const placement: BrowserWindowPlacement = {
  displayId: 1,
  slotIndex: 0,
  x: 40,
  y: 40,
  width: 720,
  height: 420,
  contentScale: 0.563,
  viewportWidth: 1280,
  viewportHeight: 800
}

realChromeDescribe('browserRuntime real Chrome on Windows', () => {
  it('fills a real compact tile, survives retile settling, and returns to native reflow after resize', async () => {
    const profileDirectory = await mkdtemp(join(tmpdir(), 'page-auto-compact-chrome-'))
    let context: BrowserContext | null = null
    let controlSession: CDPSession | null = null
    let stopResizeWatch: (() => void) | null = null

    try {
      context = await chromium.launchPersistentContext(profileDirectory, {
        channel: 'chrome',
        headless: false,
        viewport: null,
        timeout: 30_000,
        args: [
          `--window-size=${placement.width},${placement.height}`,
          `--window-position=${placement.x},${placement.y}`
        ]
      })
      const page = context.pages()[0] ?? await context.newPage()
      await page.setContent('<main style="width:100%;min-height:1200px">compact-smoke</main>')
      await applyBrowserWindowPlacement(context, page, placement)

      const compactViewport = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight
      }))
      expect(compactViewport.width).toBe(placement.viewportWidth)
      expect(compactViewport.height).toBeGreaterThan(300)
      expect(compactViewport.height).toBeLessThan(placement.viewportHeight)

      let detached = false
      stopResizeWatch = watchForManualBrowserResize(
        context,
        () => { detached = true },
        100,
        { width: placement.width, height: placement.height }
      )

      // The watcher must not interpret Windows/Chrome settling after an explicit
      // placement as a manual resize and tear down compact mode by itself.
      await page.waitForTimeout(1_000)
      expect(detached).toBe(false)

      controlSession = await context.newCDPSession(page)
      const target = await controlSession.send('Browser.getWindowForTarget') as { windowId: number }
      await controlSession.send('Browser.setWindowBounds', {
        windowId: target.windowId,
        bounds: { width: 1000, height: 700, windowState: 'normal' }
      })

      const deadline = Date.now() + 5_000
      while (!detached && Date.now() < deadline) await page.waitForTimeout(100)
      expect(detached).toBe(true)

      const nativeViewport = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight
      }))
      expect(nativeViewport.width).not.toBe(placement.viewportWidth)
      expect(nativeViewport.width).toBeGreaterThan(800)
      expect(nativeViewport.height).toBeGreaterThan(compactViewport.height)
    } finally {
      stopResizeWatch?.()
      await controlSession?.detach().catch(() => undefined)
      await context?.close().catch(() => undefined)
      await rm(profileDirectory, { recursive: true, force: true })
    }
  }, 30_000)
})
