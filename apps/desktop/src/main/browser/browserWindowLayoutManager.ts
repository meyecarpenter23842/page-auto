import { screen } from 'electron'
import type { BrowserSettings } from '../../shared/appSettings'
import {
  computeBrowserWindowPlacement,
  type BrowserDisplayInfo,
  type BrowserWindowLayoutSettings,
  type BrowserWindowPlacement
} from '../../shared/browserWindowLayout'

export type BrowserWindowOwner = 'profile' | 'posting'

interface BrowserSlotEntry {
  slotIndex: number
  owners: Set<BrowserWindowOwner>
}

export interface BrowserPlacementSnapshot {
  placements: Map<number, BrowserWindowPlacement>
  overflowCount: number
}

export class BrowserWindowLayoutManager {
  private readonly entries = new Map<number, BrowserSlotEntry>()

  claim(accountId: number, owner: BrowserWindowOwner): void {
    const existing = this.entries.get(accountId)
    if (existing) {
      existing.owners.add(owner)
      return
    }

    const used = new Set([...this.entries.values()].map((entry) => entry.slotIndex))
    let slotIndex = 0
    while (used.has(slotIndex)) slotIndex += 1
    this.entries.set(accountId, { slotIndex, owners: new Set([owner]) })
  }

  release(accountId: number, owner: BrowserWindowOwner): void {
    const entry = this.entries.get(accountId)
    if (!entry) return
    entry.owners.delete(owner)
    if (entry.owners.size === 0) this.entries.delete(accountId)
  }

  listDisplays(): BrowserDisplayInfo[] {
    const primaryId = screen.getPrimaryDisplay().id
    return screen.getAllDisplays()
      .map((display, index): BrowserDisplayInfo => ({
        id: display.id,
        label: display.label?.trim() || `Màn hình ${index + 1}`,
        isPrimary: display.id === primaryId,
        scaleFactor: display.scaleFactor,
        workArea: {
          x: display.workArea.x,
          y: display.workArea.y,
          width: display.workArea.width,
          height: display.workArea.height
        }
      }))
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.workArea.x - b.workArea.x || a.workArea.y - b.workArea.y)
  }

  placementFor(
    accountId: number,
    layout: BrowserWindowLayoutSettings,
    browser: BrowserSettings
  ): BrowserWindowPlacement | null {
    const entry = this.entries.get(accountId)
    if (!entry || !layout.enabled) return null
    const display = this.resolveDisplay(layout)
    return computeBrowserWindowPlacement(layout, browser, display, entry.slotIndex)
  }

  snapshot(
    layout: BrowserWindowLayoutSettings,
    browser: BrowserSettings
  ): BrowserPlacementSnapshot {
    const placements = new Map<number, BrowserWindowPlacement>()
    if (!layout.enabled) return { placements, overflowCount: 0 }

    const display = this.resolveDisplay(layout)
    let overflowCount = 0
    for (const [accountId, entry] of this.entries) {
      const placement = computeBrowserWindowPlacement(layout, browser, display, entry.slotIndex)
      if (placement) placements.set(accountId, placement)
      else overflowCount += 1
    }
    return { placements, overflowCount }
  }

  activeCount(): number {
    return this.entries.size
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
