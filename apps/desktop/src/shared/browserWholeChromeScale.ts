import type { BrowserWindowLayoutSettings, BrowserWindowPlacement } from './browserWindowLayout'

/**
 * Windows real-Chrome probe accepts 0.4 while retaining a desktop-width logical surface.
 * Keep this as the conservative floor until operator evidence supports a smaller value.
 */
export const MIN_WHOLE_CHROME_SCALE = 0.4

function normalizedWholeChromeScale(value: number): number {
  if (!Number.isFinite(value)) return 1
  const clamped = Math.min(1, Math.max(MIN_WHOLE_CHROME_SCALE, value))
  return Math.round(clamped * 1000) / 1000
}

/**
 * Auto Fit keeps the physical slot computed by Electron, but converts it into Chrome's
 * scaled logical coordinate space. This scales the whole browser (tabs/address bar/page)
 * instead of emulating only Facebook's viewport.
 */
export function applyWholeChromeAutoFit(
  layout: BrowserWindowLayoutSettings,
  placement: BrowserWindowPlacement | null
): BrowserWindowPlacement | null {
  if (!placement || layout.autoFit !== true) return placement

  const scale = normalizedWholeChromeScale(placement.contentScale)
  if (scale >= 0.999) return placement

  return {
    ...placement,
    x: Math.round(placement.x / scale),
    y: Math.round(placement.y / scale),
    width: Math.max(1, Math.round(placement.width / scale)),
    height: Math.max(1, Math.round(placement.height / scale)),
    contentScale: scale,
    wholeChromeScale: scale
  }
}

export function wholeChromeScaleForLaunch(
  placement: BrowserWindowPlacement | null
): number | null {
  if (!placement || placement.wholeChromeScale === undefined) return null
  return normalizedWholeChromeScale(placement.wholeChromeScale)
}

export function sameWholeChromeScale(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return left === right
  return Math.abs(left - right) < 0.001
}
