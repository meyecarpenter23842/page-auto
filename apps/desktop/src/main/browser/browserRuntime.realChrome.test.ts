import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type BrowserContext, type CDPSession } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '../../shared/appSettings'
import {
  DEFAULT_BROWSER_WINDOW_LAYOUT,
  computeBrowserWindowPlacement,
  withSquareBrowserRows,
  type BrowserDisplayInfo
} from '../../shared/browserWindowLayout'
import { applyBrowserWindowPlacement, buildBrowserLaunchOptions, watchForManualBrowserResize } from './browserRuntime'

const realChromeDescribe = process.platform === 'win32' && Boolean(process.env.CI)
  ? describe
  : describe.skip

const ciDisplay: BrowserDisplayInfo = {
  id: 1,
  label: 'CI 1080p-class work area',
  isPrimary: true,
  scaleFactor: 1,
  workArea: { x: 100, y: 40, width: 1920, height: 1040 }
}

const requestedFourByFour = withSquareBrowserRows(
  { ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true },
  4
)
const placement = computeBrowserWindowPlacement(
  requestedFourByFour,
  { ...DEFAULT_APP_SETTINGS.browser, windowWidth: 1280, windowHeight: 800 },
  ciDisplay,
  0
)
if (!placement) throw new Error('Expected a real compact placement for CI.')

realChromeDescribe('browserRuntime real Chrome on Windows', () => {
  it('keeps real Chrome square above its minimum width, removes the automation infobar switch, and preserves webdriver state', async () => {
    const profileDirectory = await mkdtemp(join(tmpdir(), 'page-auto-compact-chrome-'))
    let context: BrowserContext | null = null
    let controlSession: CDPSession | null = null
    let stopResizeWatch: (() => void) | null = null

    try {
      const launchShape = buildBrowserLaunchOptions(
        { ...DEFAULT_APP_SETTINGS.browser, executablePath: null },
        placement
      )
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

      // The Chrome infobar is tied to --enable-automation. Verify the actual Windows
      // process command line, not only the option-builder unit test.
      await page.goto('chrome://version')
      const commandLine = await page.locator('#command_line').textContent()
      expect(commandLine ?? '').not.toContain('--enable-automation')
      expect(commandLine ?? '').toContain('--remote-debugging-port=0')

      await page.goto('about:blank')
      expect(await page.evaluate(() => navigator.webdriver)).toBe(true)
      await page.setContent('<main style="width:100%;min-height:1600px">compact-smoke</main>')
      await applyBrowserWindowPlacement(context, page, placement)

      controlSession = await context.newCDPSession(page)
      const target = await controlSession.send('Browser.getWindowForTarget') as { windowId: number }
      const placedBounds = await controlSession.send('Browser.getWindowBounds', { windowId: target.windowId }) as {
        bounds: { width?: number; height?: number }
      }
      expect(placement.width).toBe(518)
      expect(placement.height).toBe(518)
      expect(Math.abs((placedBounds.bounds.width ?? 0) - placement.width)).toBeLessThanOrEqual(2)
      expect(Math.abs((placedBounds.bounds.height ?? 0) - placement.height)).toBeLessThanOrEqual(2)
      expect(Math.abs((placedBounds.bounds.width ?? 0) - (placedBounds.bounds.height ?? 0))).toBeLessThanOrEqual(2)

      const compactViewport = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight
      }))
      expect(compactViewport.width).toBe(placement.viewportWidth)
      expect(compactViewport.height).toBeGreaterThan(600)

      let detached = false
      stopResizeWatch = watchForManualBrowserResize(
        context,
        () => { detached = true },
        100,
        { width: placement.width, height: placement.height }
      )

      await page.waitForTimeout(1_000)
      expect(detached).toBe(false)

      await controlSession.send('Browser.setWindowBounds', {
        windowId: target.windowId,
        bounds: { width: 1000, height: 700, windowState: 'normal' }
      })

      const deadline = Date.now() + 5_000
      while (!detached && Date.now() < deadline) await page.waitForTimeout(100)
      expect(detached).toBe(true)

      // Chrome can report the old emulated viewport for a short moment after CDP clears
      // device metrics. Wait for native reflow, then assert against the physical window
      // that we resized to instead of assuming native width can never equal 1280.
      let nativeViewport = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight
      }))
      const nativeDeadline = Date.now() + 5_000
      while ((nativeViewport.width > 1000 || nativeViewport.height > 700) && Date.now() < nativeDeadline) {
        await page.waitForTimeout(100)
        nativeViewport = await page.evaluate(() => ({
          width: window.innerWidth,
          height: window.innerHeight
        }))
      }
      expect(nativeViewport.width).toBeGreaterThan(800)
      expect(nativeViewport.width).toBeLessThanOrEqual(1000)
      expect(nativeViewport.height).toBeGreaterThan(400)
      expect(nativeViewport.height).toBeLessThanOrEqual(700)
    } finally {
      stopResizeWatch?.()
      await controlSession?.detach().catch(() => undefined)
      await context?.close().catch(() => undefined)
      await rm(profileDirectory, { recursive: true, force: true })
    }
  }, 30_000)
})
