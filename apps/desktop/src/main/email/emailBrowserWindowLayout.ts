import { DEFAULT_APP_SETTINGS, type BrowserSettings } from '../../shared/appSettings'
import type {
  BrowserDisplayInfo,
  BrowserRetileResult,
  BrowserWindowLayoutSettings,
  BrowserWindowPlacement
} from '../../shared/browserWindowLayout'
import { BrowserSlotPool } from '../browser/browserSlotPool'
import { BrowserWindowLayoutManager } from '../browser/browserWindowLayoutManager'

export interface EmailBrowserRetilePlan {
  placements: Map<number, BrowserWindowPlacement>
  result: BrowserRetileResult
}

/**
 * Email uses the exact Facebook BrowserWindowLayoutManager/BrowserSlotPool algorithm,
 * but owns a separate slot pool. A Facebook and an Email Chrome for the same account
 * are separate desktop windows and therefore must never share one slot assignment.
 */
export class EmailBrowserWindowLayoutRuntime {
  private readonly manager = new BrowserWindowLayoutManager(new BrowserSlotPool())

  constructor(
    private readonly getLayoutSettings: () => BrowserWindowLayoutSettings,
    private readonly getBrowserSettings: () => BrowserSettings
  ) {}

  claim(accountId: number): BrowserWindowPlacement | null {
    this.manager.claim(accountId, 'email')
    return this.placementFor(accountId)
  }

  placementFor(accountId: number): BrowserWindowPlacement | null {
    return this.manager.placementFor(accountId, this.getLayoutSettings(), this.browserSettings())
  }

  release(accountId: number): void {
    this.manager.release(accountId, 'email')
  }

  listDisplays(): BrowserDisplayInfo[] {
    return this.manager.listDisplays()
  }

  activeCount(): number {
    return this.manager.activeCount()
  }

  retilePlan(): EmailBrowserRetilePlan {
    const layout = this.getLayoutSettings()
    if (!layout.enabled) {
      return {
        placements: new Map(),
        result: {
          status: 'not_compact',
          appliedCount: 0,
          overflowCount: 0,
          message: 'Compact Email đang tắt; không có cửa sổ Email nào cần sắp xếp.'
        }
      }
    }
    if (this.manager.activeCount() === 0) {
      return {
        placements: new Map(),
        result: {
          status: 'no_browsers',
          appliedCount: 0,
          overflowCount: 0,
          message: 'Chưa có Chrome Email nào đang giữ slot.'
        }
      }
    }

    const snapshot = this.manager.snapshot(layout, this.browserSettings())
    return {
      placements: snapshot.placements,
      result: {
        status: 'success',
        appliedCount: snapshot.placements.size,
        overflowCount: snapshot.overflowCount,
        message: snapshot.overflowCount > 0
          ? `Đã sắp xếp ${snapshot.placements.size} Chrome Email; ${snapshot.overflowCount} cửa sổ nằm ở lớp tràn.`
          : `Đã sắp xếp ${snapshot.placements.size} Chrome Email theo grid hiện tại.`
      }
    }
  }

  private browserSettings(): BrowserSettings {
    const browser = this.getBrowserSettings()
    return {
      ...browser,
      windowWidth: Math.max(DEFAULT_APP_SETTINGS.browser.windowWidth, browser.windowWidth),
      windowHeight: Math.max(DEFAULT_APP_SETTINGS.browser.windowHeight, browser.windowHeight)
    }
  }
}
