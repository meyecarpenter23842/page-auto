import { screen } from 'electron'
import type { BrowserSettings } from '../../shared/appSettings'
import {
  computeBrowserWindowPlacement,
  rectangularBrowserTileGrid,
  type BrowserDisplayInfo,
  type BrowserWindowLayoutSettings,
  type BrowserWindowPlacement
} from '../../shared/browserWindowLayout'
import {
  type BrowserDisplaySlotRuntimeExtension,
  type BrowserSlotRuntimeSnapshot
} from '../../shared/browserSlotDiagnostics'
import { applyWholeChromeAutoFit } from '../../shared/browserWholeChromeScale'
import { BrowserSlotPool, type BrowserWindowOwner } from './browserSlotPool'

export type { BrowserWindowOwner } from './browserSlotPool'

export interface BrowserPlacementSnapshot {
  placements: Map<number, BrowserWindowPlacement>
  overflowCount: number
}

// Browser placement is a global desktop concern. Different IPC/runtime services may own
// separate BrowserWindowLayoutManager instances, but they must coordinate one slot pool
// so Profile, Page posting and Scenario Chrome never tile on top of each other.
const SHARED_BROWSER_SLOT_POOL = new BrowserSlotPool()

export class BrowserWindowLayoutManager {
  private readonly slots = SHARED_BROWSER_SLOT_POOL

  claim(accountId: number, owner: BrowserWindowOwner): void {
    const result = this.slots.claim(accountId, owner)
    if (result.status === 'existing') return
    console.info(
      `[PAGE-AUTO slots] account=${accountId} owner=${owner} slot=${result.slotIndex} claim=${result.status}`
    )
  }

  release(accountId: number, owner: BrowserWindowOwner): void {
    const result = this.slots.release(accountId, owner)
    if (result.status === 'missing' || result.status === 'owner_missing' || result.slotIndex === null) return
    console.info(
      `[PAGE-AUTO slots] account=${accountId} owner=${owner} slot=${result.slotIndex} release=${result.status}`
    )
  }

  listDisplays(): BrowserDisplayInfo[] {
    const primaryId = screen.getPrimaryDisplay().id
    const cursorDisplayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
    const slotRuntime: BrowserSlotRuntimeSnapshot = {
      capturedAt: Date.now(),
      activeCount: this.slots.activeCount(),
      assignments: this.slots.snapshot()
    }
    return screen.getAllDisplays()
      .map((display, index): BrowserDisplayInfo & BrowserDisplaySlotRuntimeExtension => ({
        id: display.id,
        label: display.label?.trim() || `Màn hình ${index + 1}`,
        isPrimary: display.id === primaryId,
        scaleFactor: display.scaleFactor,
        workArea: {
          x: display.workArea.x,
          y: display.workArea.y,
          width: display.workArea.width,
          height: display.workArea.height
        },
        isCursorDisplay: display.id === cursorDisplayId,
        slotRuntime
      }))
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.workArea.x - b.workArea.x || a.workArea.y - b.workArea.y)
  }

  placementFor(
    accountId: number,
    layout: BrowserWindowLayoutSettings,
    browser: BrowserSettings
  ): BrowserWindowPlacement | null {
    const slotIndex = this.slots.slotFor(accountId)
    if (slotIndex === null || !layout.enabled) return null
    const display = this.resolveDisplay(layout)
    const placement = computeBrowserWindowPlacement(layout, browser, display, slotIndex)
    return applyWholeChromeAutoFit(layout, placement)
  }

  snapshot(
    layout: BrowserWindowLayoutSettings,
    browser: BrowserSettings
  ): BrowserPlacementSnapshot {
    const placements = new Map<number, BrowserWindowPlacement>()
    if (!layout.enabled) return { placements, overflowCount: 0 }

    // snapshot() is used by the explicit operator "Sắp xếp lại Chrome" action.
    // Normal claim/release never compacts, so unrelated active Chrome stay in place.
    const compactedCount = this.slots.compact()
    if (compactedCount > 0) {
      console.info(`[PAGE-AUTO slots] retile compacted=${compactedCount} active=${this.slots.activeCount()}`)
    }

    const assignments = this.slots.snapshot()
    const display = this.resolveDisplay(layout)
    const visibleCapacity = rectangularBrowserTileGrid(layout, display, browser).capacity
    let overflowCount = 0
    for (const assignment of assignments) {
      if (assignment.slotIndex >= visibleCapacity) overflowCount += 1
      const placement = computeBrowserWindowPlacement(layout, browser, display, assignment.slotIndex)
      const fittedPlacement = applyWholeChromeAutoFit(layout, placement)
      if (fittedPlacement) placements.set(assignment.accountId, fittedPlacement)
    }
    return { placements, overflowCount }
  }

  activeCount(): number {
    return this.slots.activeCount()
  }

  private resolveDisplay(layout: BrowserWindowLayoutSettings): BrowserDisplayInfo {
    const displays = this.listDisplays()
    if (layout.targetDisplayId !== null) {
      const selected = displays.find((display) => display.id === layout.targetDisplayId)
      if (selected) return selected
    }

    const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    return displays.find((display) => display.id === cursorDisplay.id)
      ?? displays.find((display) => display.isPrimary)
      ?? displays[0]
      ?? {
        id: 0,
        label: 'Màn hình mặc định',
        isPrimary: true,
        scaleFactor: 1,
        workArea: { x: 0, y: 0, width: browserFallbackWidth(), height: browserFallbackHeight() }
      }
  }
}

function browserFallbackWidth(): number { return 1280 }
function browserFallbackHeight(): number { return 720 }
