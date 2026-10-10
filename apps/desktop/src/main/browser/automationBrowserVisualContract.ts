import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserContext, CDPSession, Page } from 'playwright-core'

const PAGE_ZOOM_TOLERANCE = 0.03
const PAGE_ZOOM_SETTLE_MS = 100
const PAGE_ZOOM_STABILITY_TOLERANCE = 0.005
const PAGE_ZOOM_SETTLE_READS = 3
const PAGE_ZOOM_MAX_ADJUSTMENTS = 8
const CONTROL_MODIFIER = 2
const SHIFT_MODIFIER = 8

interface JsonRecord {
  [key: string]: unknown
}

export interface AutomationProfileZoomNormalizationResult {
  status: 'normalized' | 'already_normalized' | 'preferences_missing' | 'preferences_invalid'
  changed: boolean
}

export interface AutomationPageZoomNormalizationResult {
  status: 'ready' | 'normalized' | 'unavailable' | 'failed'
  before: number | null
  after: number | null
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isFacebookZoomKey(key: string): boolean {
  return /(^|[.:/])(?:www\.)?facebook\.com(?=$|[/:])/i.test(key)
}

function zeroNumericValues(value: unknown): boolean {
  if (!isRecord(value)) return false
  let changed = false
  for (const [key, current] of Object.entries(value)) {
    if (typeof current === 'number' && current !== 0) {
      value[key] = 0
      changed = true
    }
  }
  return changed
}

function clearFacebookZoomEntries(value: unknown): boolean {
  if (!isRecord(value)) return false
  let changed = false
  for (const key of Object.keys(value)) {
    if (isFacebookZoomKey(key)) {
      delete value[key]
      changed = true
      continue
    }
    changed = clearFacebookZoomEntries(value[key]) || changed
  }
  return changed
}

/**
 * Chrome persists default/per-host page zoom in the profile Preferences file. Automation
 * must not inherit an operator's previous Facebook zoom because that changes responsive DOM.
 * Keep unrelated preferences and non-Facebook per-host zoom entries intact.
 */
export async function normalizeAutomationProfileZoom(
  userDataDir: string
): Promise<AutomationProfileZoomNormalizationResult> {
  const preferencesPath = join(userDataDir, 'Default', 'Preferences')
  let source: string
  try {
    source = await readFile(preferencesPath, 'utf8')
  } catch {
    return { status: 'preferences_missing', changed: false }
  }

  let preferences: JsonRecord
  try {
    const parsed = JSON.parse(source) as unknown
    if (!isRecord(parsed)) return { status: 'preferences_invalid', changed: false }
    preferences = parsed
  } catch {
    return { status: 'preferences_invalid', changed: false }
  }

  let changed = false
  const partition = preferences.partition
  if (isRecord(partition)) {
    const defaultZoom = partition.default_zoom_level
    if (typeof defaultZoom === 'number') {
      if (defaultZoom !== 0) {
        partition.default_zoom_level = 0
        changed = true
      }
    } else {
      changed = zeroNumericValues(defaultZoom) || changed
    }
    changed = clearFacebookZoomEntries(partition.per_host_zoom_levels) || changed
  }

  const profile = preferences.profile
  if (isRecord(profile)) {
    if (typeof profile.default_zoom_level === 'number' && profile.default_zoom_level !== 0) {
      profile.default_zoom_level = 0
      changed = true
    }
    changed = clearFacebookZoomEntries(profile.per_host_zoom_levels) || changed
  }

  if (!changed) return { status: 'already_normalized', changed: false }
  await writeFile(preferencesPath, JSON.stringify(preferences), 'utf8')
  return { status: 'normalized', changed: true }
}

function zoomIsNeutral(zoom: number): boolean {
  return Number.isFinite(zoom) && Math.abs(zoom - 1) <= PAGE_ZOOM_TOLERANCE
}

function zoomIsSame(left: number, right: number): boolean {
  return Math.abs(left - right) <= PAGE_ZOOM_STABILITY_TOLERANCE
}

async function readPageZoom(session: CDPSession): Promise<number | null> {
  const metrics = await session.send('Page.getLayoutMetrics').catch(() => null) as {
    cssVisualViewport?: { zoom?: number }
    visualViewport?: { zoom?: number }
  } | null
  const zoom = metrics?.cssVisualViewport?.zoom ?? metrics?.visualViewport?.zoom
  return typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0 ? zoom : null
}

async function dispatchZoomShortcut(
  session: CDPSession,
  shortcut: 'reset' | 'in' | 'out'
): Promise<boolean> {
  const key = shortcut === 'reset' ? '0' : shortcut === 'in' ? '+' : '-'
  const code = shortcut === 'reset' ? 'Digit0' : shortcut === 'in' ? 'Equal' : 'Minus'
  const keyCode = shortcut === 'reset' ? 48 : shortcut === 'in' ? 187 : 189
  const modifiers = CONTROL_MODIFIER | (shortcut === 'in' ? SHIFT_MODIFIER : 0)
  const payload = {
    modifiers,
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode
  }

  const down = await session.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    ...payload
  }).then(() => true).catch(() => false)
  if (!down) return false
  return session.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    ...payload
  }).then(() => true).catch(() => false)
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, PAGE_ZOOM_SETTLE_MS))
}

/**
 * Window resize/native placement can make Page.getLayoutMetrics briefly expose a zoom value
 * from an intermediate renderer frame. Do not turn that transient value into Ctrl+0/+/- input.
 * Return as soon as zoom is neutral or the same non-neutral value is observed twice in a row.
 */
async function readSettledPageZoom(
  session: CDPSession,
  initial: number | null = null
): Promise<number | null> {
  let previous = initial
  if (previous !== null && zoomIsNeutral(previous)) return previous

  for (let read = 0; read < PAGE_ZOOM_SETTLE_READS; read += 1) {
    if (previous !== null || read > 0) await settle()
    const current = await readPageZoom(session)
    if (current === null) {
      previous = null
      continue
    }
    if (zoomIsNeutral(current)) return current
    if (previous !== null && zoomIsSame(previous, current)) return current
    previous = current
  }

  return previous
}

/**
 * Reset true Chrome page zoom, not CSS zoom/emulation. Ctrl+0 is attempted first; if the
 * profile default itself is non-100%, step through Chrome's native zoom levels until the
 * target tab reports page zoom ~= 1. Emulation page scale is also cleared so pinch/device
 * emulation cannot survive into the automation visual contract.
 *
 * Native window placement can reflow Chromium asynchronously. A bounded settle read happens
 * before shortcuts and after each shortcut so a transient layout-metric frame is never treated
 * as a real user page-zoom setting.
 */
export async function normalizeAutomationPageZoom(
  context: BrowserContext,
  page: Page
): Promise<AutomationPageZoomNormalizationResult> {
  const session = await context.newCDPSession(page).catch(() => null)
  if (!session) return { status: 'unavailable', before: null, after: null }

  try {
    const before = await readPageZoom(session)
    if (before === null) return { status: 'unavailable', before: null, after: null }

    await session.send('Emulation.resetPageScaleFactor').catch(() => undefined)
    if (zoomIsNeutral(before)) return { status: 'ready', before, after: before }

    const settledBeforeShortcut = await readSettledPageZoom(session, before)
    if (settledBeforeShortcut === null) {
      return { status: 'unavailable', before, after: null }
    }
    if (zoomIsNeutral(settledBeforeShortcut)) {
      return { status: 'normalized', before, after: settledBeforeShortcut }
    }

    if (!await dispatchZoomShortcut(session, 'reset')) {
      return { status: 'failed', before, after: await readPageZoom(session) }
    }
    let after = await readSettledPageZoom(session)
    if (after !== null && zoomIsNeutral(after)) return { status: 'normalized', before, after }

    for (let attempt = 0; attempt < PAGE_ZOOM_MAX_ADJUSTMENTS && after !== null; attempt += 1) {
      const shortcut = after < 1 ? 'in' : 'out'
      if (!await dispatchZoomShortcut(session, shortcut)) break
      after = await readSettledPageZoom(session)
      if (after !== null && zoomIsNeutral(after)) {
        return { status: 'normalized', before, after }
      }
    }

    return { status: 'failed', before, after }
  } finally {
    await session.detach().catch(() => undefined)
  }
}
