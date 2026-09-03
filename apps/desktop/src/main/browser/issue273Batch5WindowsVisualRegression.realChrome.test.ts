import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type BrowserContext, type CDPSession, type Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '../../shared/appSettings'
import type { BrowserWindowPlacement } from '../../shared/browserWindowLayout'
import {
  normalizeAutomationPageZoom,
  normalizeAutomationProfileZoom
} from './automationBrowserVisualContract'
import { applyBrowserWindowPlacement, buildBrowserLaunchOptions } from './browserRuntime'
import {
  captureBrowserVisualLayoutBaseline,
  clearBrowserVisualLayoutBaseline,
  ensureBrowserVisualLayout,
  getBrowserVisualLayoutBaseline
} from './browserVisualLayoutGuard'

const realChromeDescribe = process.platform === 'win32' && Boolean(process.env.CI)
  ? describe
  : describe.skip

const COMPACT_SCALE = 0.8
const compactPlacement: BrowserWindowPlacement = {
  displayId: 1,
  slotIndex: 0,
  x: 120,
  y: 80,
  width: 700,
  height: 550,
  contentScale: COMPACT_SCALE,
  wholeChromeScale: COMPACT_SCALE,
  viewportWidth: 1280,
  viewportHeight: 800
}

interface NativeBounds {
  width: number
  height: number
}

function resizeTargetAwayFrom(
  initial: NativeBounds,
  widthDelta: number,
  heightDelta: number,
  minWidth: number,
  minHeight: number
): NativeBounds {
  return {
    width: initial.width - widthDelta >= minWidth
      ? initial.width - widthDelta
      : initial.width + widthDelta,
    height: initial.height - heightDelta >= minHeight
      ? initial.height - heightDelta
      : initial.height + heightDelta
  }
}

function maxBoundsDelta(left: NativeBounds, right: NativeBounds): number {
  return Math.max(
    Math.abs(left.width - right.width),
    Math.abs(left.height - right.height)
  )
}

async function startLocalPageServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>issue-273-batch5</title><main style="min-height:1600px">ready</main>')
  })
  await new Promise<void>((resolve, reject) => {
    const fail = (error: Error) => reject(error)
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', fail)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw new Error('Unable to resolve local Batch 5 server address')
  }
  return { server, url: `http://127.0.0.1:${address.port}/` }
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server) return
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

async function seedPersistedZoom(profileDirectory: string, zoomLevel: number): Promise<void> {
  const defaultDirectory = join(profileDirectory, 'Default')
  await mkdir(defaultDirectory, { recursive: true })
  await writeFile(join(defaultDirectory, 'Preferences'), JSON.stringify({
    partition: {
      default_zoom_level: { x: zoomLevel }
    }
  }), 'utf8')
}

async function readPageZoom(session: CDPSession): Promise<number | null> {
  const metrics = await session.send('Page.getLayoutMetrics') as {
    cssVisualViewport?: { zoom?: number }
  }
  const zoom = metrics.cssVisualViewport?.zoom
  return typeof zoom === 'number' && Number.isFinite(zoom) ? zoom : null
}

async function browserWindowId(session: CDPSession): Promise<number> {
  const target = await session.send('Browser.getWindowForTarget') as { windowId?: number }
  if (target.windowId === undefined) throw new Error('Chrome target has no native window id')
  return target.windowId
}

async function readNativeBounds(session: CDPSession, windowId: number): Promise<NativeBounds> {
  const result = await session.send('Browser.getWindowBounds', { windowId }) as {
    bounds?: { width?: number; height?: number }
  }
  return {
    width: typeof result.bounds?.width === 'number' ? result.bounds.width : 0,
    height: typeof result.bounds?.height === 'number' ? result.bounds.height : 0
  }
}

async function setAndWaitForStableBounds(
  session: CDPSession,
  windowId: number,
  requested: NativeBounds
): Promise<NativeBounds> {
  await session.send('Browser.setWindowBounds', {
    windowId,
    bounds: {
      width: requested.width,
      height: requested.height,
      windowState: 'normal'
    }
  })

  const deadline = Date.now() + 4_000
  let previous: NativeBounds | null = null
  let stableReads = 0
  let latest: NativeBounds = { width: 0, height: 0 }

  while (Date.now() < deadline) {
    latest = await readNativeBounds(session, windowId)
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

function normalLaunchShape() {
  return buildBrowserLaunchOptions({
    ...DEFAULT_APP_SETTINGS.browser,
    executablePath: null,
    windowWidth: 1280,
    windowHeight: 800
  })
}

function compactLaunchShape() {
  const shape = buildBrowserLaunchOptions({
    ...DEFAULT_APP_SETTINGS.browser,
    executablePath: null,
    windowWidth: 1280,
    windowHeight: 800
  }, compactPlacement)
  return {
    ...shape,
    args: [...shape.args, `--force-device-scale-factor=${COMPACT_SCALE}`]
  }
}

async function openPage(context: BrowserContext, url: string): Promise<Page> {
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto(url)
  return page
}

realChromeDescribe('Issue #273 Batch 5 Windows visual recovery matrix', () => {
  it('isolates two account-like Chrome baselines across Compact OFF/ON and manual resize recovery', async () => {
    const normalProfile = await mkdtemp(join(tmpdir(), 'page-auto-batch5-normal-'))
    const compactProfile = await mkdtemp(join(tmpdir(), 'page-auto-batch5-compact-'))
    let normalContext: BrowserContext | null = null
    let compactContext: BrowserContext | null = null
    let normalSession: CDPSession | null = null
    let compactSession: CDPSession | null = null
    let server: Server | null = null

    try {
      await Promise.all([
        seedPersistedZoom(normalProfile, 1.2),
        seedPersistedZoom(compactProfile, 1.2)
      ])
      const [normalProfileNormalization, compactProfileNormalization] = await Promise.all([
        normalizeAutomationProfileZoom(normalProfile),
        normalizeAutomationProfileZoom(compactProfile)
      ])
      expect(normalProfileNormalization.status).toBe('normalized')
      expect(normalProfileNormalization.changed).toBe(true)
      expect(compactProfileNormalization.status).toBe('normalized')
      expect(compactProfileNormalization.changed).toBe(true)

      const localPage = await startLocalPageServer()
      server = localPage.server

      ;[normalContext, compactContext] = await Promise.all([
        chromium.launchPersistentContext(normalProfile, {
          ...normalLaunchShape(),
          viewport: null
        }),
        chromium.launchPersistentContext(compactProfile, {
          ...compactLaunchShape(),
          viewport: null
        })
      ])

      const [normalPage, compactPage] = await Promise.all([
        openPage(normalContext, localPage.url),
        openPage(compactContext, localPage.url)
      ])
      ;[normalSession, compactSession] = await Promise.all([
        normalContext.newCDPSession(normalPage),
        compactContext.newCDPSession(compactPage)
      ])

      const [normalZoom, compactZoom] = await Promise.all([
        readPageZoom(normalSession),
        readPageZoom(compactSession)
      ])
      expect(normalZoom).not.toBeNull()
      expect(normalZoom).toBeCloseTo(1, 2)
      expect(compactZoom).not.toBeNull()
      expect(compactZoom).toBeCloseTo(1, 2)

      const [normalZoomReadiness, compactZoomReadiness] = await Promise.all([
        normalizeAutomationPageZoom(normalContext, normalPage),
        normalizeAutomationPageZoom(compactContext, compactPage)
      ])
      expect(normalZoomReadiness.status).toBe('ready')
      expect(compactZoomReadiness.status).toBe('ready')

      await applyBrowserWindowPlacement(compactContext, compactPage, compactPlacement)

      const normalWindowId = await browserWindowId(normalSession)
      const compactWindowId = await browserWindowId(compactSession)
      const normalInitialBounds = await readNativeBounds(normalSession, normalWindowId)
      const compactInitialBounds = await readNativeBounds(compactSession, compactWindowId)
      expect(normalInitialBounds.width).toBeGreaterThan(0)
      expect(compactInitialBounds.width).toBeGreaterThan(0)

      let normalDetached = false
      let compactDetached = false
      const normalState = () => ({
        browserScale: 1,
        compact: false,
        manualResizeDetached: normalDetached
      })
      const compactState = () => ({
        browserScale: COMPACT_SCALE,
        compact: true,
        manualResizeDetached: compactDetached
      })

      const [normalBaseline, compactBaseline] = await Promise.all([
        captureBrowserVisualLayoutBaseline(normalContext, normalPage, normalState()),
        captureBrowserVisualLayoutBaseline(compactContext, compactPage, compactState())
      ])
      expect(normalBaseline).not.toBeNull()
      expect(compactBaseline).not.toBeNull()
      expect(normalBaseline?.compact).toBe(false)
      expect(compactBaseline?.compact).toBe(true)
      expect(normalBaseline?.browserScale).toBe(1)
      expect(compactBaseline?.browserScale).toBeCloseTo(COMPACT_SCALE, 3)

      const normalResizeTarget = resizeTargetAwayFrom(normalInitialBounds, 180, 90, 640, 520)
      const compactResizeTarget = resizeTargetAwayFrom(compactInitialBounds, 120, 80, 520, 420)
      const [normalResizedBounds, compactResizedBounds] = await Promise.all([
        setAndWaitForStableBounds(normalSession, normalWindowId, normalResizeTarget),
        setAndWaitForStableBounds(compactSession, compactWindowId, compactResizeTarget)
      ])
      expect(maxBoundsDelta(normalResizedBounds, normalInitialBounds)).toBeGreaterThan(16)
      expect(maxBoundsDelta(compactResizedBounds, compactInitialBounds)).toBeGreaterThan(16)
      normalDetached = true
      compactDetached = true

      const [normalRecovery, compactRecovery] = await Promise.all([
        ensureBrowserVisualLayout({
          context: normalContext,
          page: normalPage,
          readState: normalState,
          recover: async () => {
            normalDetached = false
            const zoom = await normalizeAutomationPageZoom(normalContext!, normalPage)
            return zoom.status === 'failed' ? 'failed' : 'rebaseline'
          }
        }),
        ensureBrowserVisualLayout({
          context: compactContext,
          page: compactPage,
          readState: compactState,
          recover: async () => {
            compactDetached = false
            await applyBrowserWindowPlacement(compactContext!, compactPage, compactPlacement)
            const zoom = await normalizeAutomationPageZoom(compactContext!, compactPage)
            return zoom.status === 'failed' ? 'failed' : 'recovered_geometry'
          }
        })
      ])

      expect(normalRecovery.status).toBe('rebaselined')
      expect(normalRecovery.drift).toContain('window_bounds')
      expect(normalRecovery.drift).toContain('manual_resize_detached')
      expect(compactRecovery.status, `${compactRecovery.message}; drift=${compactRecovery.drift.join(',')}`).toBe('recovered')
      expect(compactRecovery.drift).toContain('window_bounds')
      expect(compactRecovery.drift).toContain('manual_resize_detached')

      const finalNormalBaseline = getBrowserVisualLayoutBaseline(normalContext)
      const finalCompactBaseline = getBrowserVisualLayoutBaseline(compactContext)
      expect(finalNormalBaseline).not.toBeNull()
      expect(finalCompactBaseline).not.toBeNull()
      expect(finalNormalBaseline?.compact).toBe(false)
      expect(finalCompactBaseline?.compact).toBe(true)
      expect(finalNormalBaseline?.manualResizeDetached).toBe(false)
      expect(finalCompactBaseline?.manualResizeDetached).toBe(false)
      expect(finalNormalBaseline?.outerWidth).toBeCloseTo(normalResizedBounds.width, -1)

      const compactFinalBounds = await readNativeBounds(compactSession, compactWindowId)
      expect(Math.abs(compactFinalBounds.width - compactPlacement.width)).toBeLessThanOrEqual(4)
      expect(Math.abs(compactFinalBounds.height - compactPlacement.height)).toBeLessThanOrEqual(4)

      const compactMetrics = await compactPage.evaluate(() => ({
        dpr: window.devicePixelRatio,
        width: window.innerWidth,
        height: window.innerHeight
      }))
      expect(compactMetrics.dpr).toBeCloseTo(COMPACT_SCALE, 2)
      expect(compactMetrics.width).toBeGreaterThan(0)
      expect(compactMetrics.height).toBeGreaterThan(0)

      const finalZoom = await readPageZoom(compactSession)
      expect(finalZoom).not.toBeNull()
      expect(finalZoom).toBeCloseTo(1, 2)
    } finally {
      if (normalContext) clearBrowserVisualLayoutBaseline(normalContext)
      if (compactContext) clearBrowserVisualLayoutBaseline(compactContext)
      await normalSession?.detach().catch(() => undefined)
      await compactSession?.detach().catch(() => undefined)
      await normalContext?.close().catch(() => undefined)
      await compactContext?.close().catch(() => undefined)
      await closeServer(server)
      await rm(normalProfile, { recursive: true, force: true })
      await rm(compactProfile, { recursive: true, force: true })
    }
  }, 120_000)
})
