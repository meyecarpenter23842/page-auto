import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BrowserContext, CDPSession, Page } from 'playwright-core'
import {
  normalizeAutomationPageZoom,
  normalizeAutomationProfileZoom
} from './automationBrowserVisualContract'

describe('automationBrowserVisualContract', () => {
  it('resets persisted default/Facebook zoom without deleting unrelated host zoom entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'page-auto-zoom-'))
    const profile = join(root, 'Default')
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'Preferences'), JSON.stringify({
      partition: {
        default_zoom_level: { x: -1.2239 },
        per_host_zoom_levels: {
          x: {
            'www.facebook.com': { zoom_level: -1.2239 },
            'example.com': { zoom_level: 0.5778 }
          }
        }
      },
      profile: {
        default_zoom_level: 0.5778,
        per_host_zoom_levels: {
          'https://facebook.com': -0.5778,
          'example.org': 0.5778
        }
      },
      untouched: { value: 42 }
    }), 'utf8')

    const result = await normalizeAutomationProfileZoom(root)
    const preferences = JSON.parse(await readFile(join(profile, 'Preferences'), 'utf8'))

    expect(result).toEqual({ status: 'normalized', changed: true })
    expect(preferences.partition.default_zoom_level.x).toBe(0)
    expect(preferences.partition.per_host_zoom_levels.x['www.facebook.com']).toBeUndefined()
    expect(preferences.partition.per_host_zoom_levels.x['example.com']).toEqual({ zoom_level: 0.5778 })
    expect(preferences.profile.default_zoom_level).toBe(0)
    expect(preferences.profile.per_host_zoom_levels['https://facebook.com']).toBeUndefined()
    expect(preferences.profile.per_host_zoom_levels['example.org']).toBe(0.5778)
    expect(preferences.untouched.value).toBe(42)
  })

  it('uses native Chrome zoom shortcuts until the live page reports 100 percent', async () => {
    let zoom = 0.8
    const sent: string[] = []
    const session = {
      send: async (method: string, params?: { type?: string; code?: string }) => {
        if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { zoom } }
        if (method === 'Emulation.resetPageScaleFactor') return {}
        if (method === 'Input.dispatchKeyEvent') {
          if (params?.type === 'rawKeyDown') {
            sent.push(params.code ?? '')
            if (params.code === 'Digit0') zoom = 0.8
            else if (params.code === 'Equal') zoom = zoom < 0.9 ? 0.9 : 1
            else if (params.code === 'Minus') zoom = zoom > 1.1 ? 1.1 : 1
          }
          return {}
        }
        return {}
      },
      detach: async () => undefined
    } as unknown as CDPSession
    const context = {
      newCDPSession: async () => session
    } as unknown as BrowserContext

    const result = await normalizeAutomationPageZoom(context, {} as Page)

    expect(result.status).toBe('normalized')
    expect(result.before).toBe(0.8)
    expect(result.after).toBe(1)
    expect(sent).toEqual(['Digit0', 'Equal', 'Equal'])
  })

  it('does not send zoom shortcuts when the live page is already at 100 percent', async () => {
    let inputEvents = 0
    const session = {
      send: async (method: string) => {
        if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { zoom: 1 } }
        if (method === 'Input.dispatchKeyEvent') inputEvents += 1
        return {}
      },
      detach: async () => undefined
    } as unknown as CDPSession
    const context = { newCDPSession: async () => session } as unknown as BrowserContext

    const result = await normalizeAutomationPageZoom(context, {} as Page)

    expect(result).toEqual({ status: 'ready', before: 1, after: 1 })
    expect(inputEvents).toBe(0)
  })
})
