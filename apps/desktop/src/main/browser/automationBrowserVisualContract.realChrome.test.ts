import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type BrowserContext, type CDPSession } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '../../shared/appSettings'
import {
  normalizeAutomationPageZoom,
  normalizeAutomationProfileZoom
} from './automationBrowserVisualContract'
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

function launchShape() {
  return buildBrowserLaunchOptions({
    ...DEFAULT_APP_SETTINGS.browser,
    executablePath: null,
    windowWidth: 1280,
    windowHeight: 800
  })
}

async function startLocalPageServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>visual-contract</title><main>ready</main>')
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
    throw new Error('Unable to resolve local visual-contract server address')
  }
  return { server, url: `http://127.0.0.1:${address.port}/` }
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server) return
  await new Promise<void>((resolve) => server.close(() => resolve()))
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

      context = await chromium.launchPersistentContext(profileDirectory, {
        ...launchShape(),
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

  it('restores an already-open Chrome tab to 100 percent from a persisted true Chrome zoom', async () => {
    const profileDirectory = await mkdtemp(join(tmpdir(), 'page-auto-live-zoom-contract-'))
    let context: BrowserContext | null = null
    let session: CDPSession | null = null
    let server: Server | null = null

    try {
      const defaultDirectory = join(profileDirectory, 'Default')
      await mkdir(defaultDirectory, { recursive: true })
      await writeFile(join(defaultDirectory, 'Preferences'), JSON.stringify({
        partition: {
          // Chromium stores the default page zoom level per storage partition.
          // `x` is the key for the default profile storage partition.
          default_zoom_level: { x: 1.2 }
        }
      }), 'utf8')

      const localPage = await startLocalPageServer()
      server = localPage.server

      context = await chromium.launchPersistentContext(profileDirectory, {
        ...launchShape(),
        viewport: null
      })
      const page = context.pages()[0] ?? await context.newPage()
      await page.goto(localPage.url)
      session = await context.newCDPSession(page)

      const drifted = await readPageZoom(session)
      expect(drifted).not.toBeNull()
      expect(Math.abs((drifted ?? 1) - 1)).toBeGreaterThan(0.05)

      const normalized = await normalizeAutomationPageZoom(context, page)
      expect(normalized.status).toBe('normalized')
      expect(normalized.before).not.toBeNull()
      expect(normalized.before ?? 1).toBeCloseTo(drifted ?? 1, 2)
      expect(normalized.after).not.toBeNull()
      expect(normalized.after).toBeCloseTo(1, 2)

      const finalZoom = await readPageZoom(session)
      expect(finalZoom).not.toBeNull()
      expect(finalZoom).toBeCloseTo(1, 2)
    } finally {
      await session?.detach().catch(() => undefined)
      await context?.close().catch(() => undefined)
      await closeServer(server)
      await rm(profileDirectory, { recursive: true, force: true })
    }
  }, 45_000)
})
