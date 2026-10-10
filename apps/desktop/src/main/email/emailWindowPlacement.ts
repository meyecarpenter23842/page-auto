import type { BrowserContext, Page } from 'playwright-core'
import type { BrowserWindowPlacement } from '../../shared/browserWindowLayout'
import { sameWholeChromeScale, wholeChromeScaleForLaunch } from '../../shared/browserWholeChromeScale'
import {
  applyBrowserPlacementToContext,
  applyBrowserWindowPlacement,
  watchForManualBrowserResize
} from '../browser/browserRuntime'

export function emailPlacementLaunchArgs(placement: BrowserWindowPlacement | null): string[] {
  if (!placement) return []
  const scale = wholeChromeScaleForLaunch(placement)
  return [
    `--window-size=${placement.width},${placement.height}`,
    `--window-position=${placement.x},${placement.y}`,
    ...(scale !== null ? [`--force-device-scale-factor=${scale}`] : [])
  ]
}

/**
 * Worker-side native placement controller shared by Microsoft and temporary-provider
 * Email browsers. It intentionally delegates bounds and resize detection to the same
 * browserRuntime primitives used by Facebook Compact.
 */
export class EmailWindowPlacementController {
  private activePlacement: BrowserWindowPlacement | null = null
  private launchedWholeChromeScale: number | null = null
  private manualResizeDetached = false
  private stopResizeWatch: (() => void) | null = null

  constructor(private readonly onDetached: () => void) {}

  prepareLaunch(placement: BrowserWindowPlacement | null): string[] {
    this.activePlacement = placement
    this.launchedWholeChromeScale = wholeChromeScaleForLaunch(placement)
    this.manualResizeDetached = false
    return emailPlacementLaunchArgs(placement)
  }

  adoptAttachedPlacement(placement: BrowserWindowPlacement | null): void {
    this.activePlacement = placement
    // An app-owned Email profile normally re-attaches with the same requested scale.
    // Treat the requested scale as the running contract; if the operator launched a
    // foreign browser manually, a manual resize will detach it from Compact safely.
    this.launchedWholeChromeScale = wholeChromeScaleForLaunch(placement)
    this.manualResizeDetached = false
  }

  async apply(context: BrowserContext, placement: BrowserWindowPlacement | null): Promise<boolean> {
    if (this.manualResizeDetached) return false
    if (!sameWholeChromeScale(this.launchedWholeChromeScale, wholeChromeScaleForLaunch(placement))) {
      console.info(
        `[PAGE-AUTO email compact-scale] reopen-required running=${this.launchedWholeChromeScale ?? 1} requested=${wholeChromeScaleForLaunch(placement) ?? 1}`
      )
      return false
    }

    this.activePlacement = placement
    this.stopWatching()
    await applyBrowserPlacementToContext(context, placement)
    this.armResizeWatch(context)
    return true
  }

  async forceRetile(context: BrowserContext, placement: BrowserWindowPlacement | null): Promise<boolean> {
    this.manualResizeDetached = false
    if (!sameWholeChromeScale(this.launchedWholeChromeScale, wholeChromeScaleForLaunch(placement))) {
      console.info(
        `[PAGE-AUTO email compact-scale] reopen-required running=${this.launchedWholeChromeScale ?? 1} requested=${wholeChromeScaleForLaunch(placement) ?? 1}`
      )
      return false
    }
    this.activePlacement = placement
    this.stopWatching()
    await applyBrowserPlacementToContext(context, placement)
    this.armResizeWatch(context)
    return true
  }

  async applyToNewPage(context: BrowserContext, page: Page): Promise<void> {
    if (this.manualResizeDetached) return
    await applyBrowserWindowPlacement(context, page, this.activePlacement)
  }

  clear(): void {
    this.stopWatching()
    this.activePlacement = null
    this.launchedWholeChromeScale = null
    this.manualResizeDetached = false
  }

  private armResizeWatch(context: BrowserContext): void {
    this.stopWatching()
    const placement = this.activePlacement
    if (!placement || this.manualResizeDetached) return
    this.stopResizeWatch = watchForManualBrowserResize(context, () => {
      this.manualResizeDetached = true
      this.activePlacement = null
      this.stopResizeWatch = null
      this.onDetached()
    }, 350, { width: placement.width, height: placement.height })
  }

  private stopWatching(): void {
    this.stopResizeWatch?.()
    this.stopResizeWatch = null
  }
}
