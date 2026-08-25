import { describe, expect, it } from 'vitest'
import { DEFAULT_BROWSER_WINDOW_LAYOUT, type BrowserWindowPlacement } from './browserWindowLayout'
import {
  MIN_WHOLE_CHROME_SCALE,
  applyWholeChromeAutoFit,
  sameWholeChromeScale,
  wholeChromeScaleForLaunch
} from './browserWholeChromeScale'

const compactPlacement: BrowserWindowPlacement = {
  displayId: 1,
  slotIndex: 0,
  x: 306,
  y: 206,
  width: 500,
  height: 313,
  contentScale: 0.391,
  viewportWidth: 1280,
  viewportHeight: 800
}

describe('whole Chrome Auto Fit', () => {
  it('leaves manual native Width×Height placement unchanged', () => {
    const result = applyWholeChromeAutoFit(
      { ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true, autoFit: false },
      compactPlacement
    )
    expect(result).toEqual(compactPlacement)
    expect(wholeChromeScaleForLaunch(result)).toBeNull()
  })

  it('keeps the physical slot while converting it into scaled Chrome coordinates', () => {
    const result = applyWholeChromeAutoFit(
      { ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true, autoFit: true },
      compactPlacement
    )

    expect(MIN_WHOLE_CHROME_SCALE).toBe(0.4)
    expect(result).toMatchObject({
      x: 765,
      y: 515,
      width: 1250,
      height: 783,
      viewportWidth: 1280,
      viewportHeight: 800,
      contentScale: 0.4,
      wholeChromeScale: 0.4
    })
    expect((result?.width ?? 0) * (result?.wholeChromeScale ?? 1)).toBeCloseTo(500, 0)
    expect((result?.height ?? 0) * (result?.wholeChromeScale ?? 1)).toBeCloseTo(313, 0)
    expect(wholeChromeScaleForLaunch(result)).toBe(0.4)
  })

  it('preserves larger proven scale factors instead of always forcing the floor', () => {
    const result = applyWholeChromeAutoFit(
      { ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true, autoFit: true },
      { ...compactPlacement, x: 120, y: 90, width: 640, height: 400, contentScale: 0.5 }
    )
    expect(result).toMatchObject({
      x: 240,
      y: 180,
      width: 1280,
      height: 800,
      contentScale: 0.5,
      wholeChromeScale: 0.5
    })
    expect(wholeChromeScaleForLaunch(result)).toBe(0.5)
  })

  it('does not request a launch scale when the desktop already fits at 100%', () => {
    const result = applyWholeChromeAutoFit(
      { ...DEFAULT_BROWSER_WINDOW_LAYOUT, enabled: true, autoFit: true },
      { ...compactPlacement, width: 1280, height: 800, contentScale: 1 }
    )
    expect(result?.contentScale).toBe(1)
    expect(result?.wholeChromeScale).toBeUndefined()
    expect(wholeChromeScaleForLaunch(result)).toBeNull()
  })

  it('compares launch scale changes with a small floating-point tolerance', () => {
    expect(sameWholeChromeScale(0.4, 0.40000001)).toBe(true)
    expect(sameWholeChromeScale(0.4, 0.5)).toBe(false)
    expect(sameWholeChromeScale(null, null)).toBe(true)
    expect(sameWholeChromeScale(null, 0.4)).toBe(false)
  })
})
