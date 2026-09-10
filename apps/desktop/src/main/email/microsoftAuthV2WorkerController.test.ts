import { describe, expect, it, vi } from 'vitest'
import type { BrowserContext, Page } from 'playwright-core'
import {
  keepMicrosoftForegroundDuring,
  shouldContinueRecoveryPostCodeSettle,
  shouldYieldRecoveryNeedsAttentionToFreshSurface
} from './microsoftAuthV2WorkerController'

type PageListener = (page: Page) => void

type FakeContext = BrowserContext & {
  emitPage: (page: Page) => void
}

function fakeContext(): FakeContext {
  const pageListeners = new Set<PageListener>()
  const context = {} as FakeContext

  Object.assign(context, {
    on: vi.fn((event: string, listener: PageListener) => {
      if (event === 'page') pageListeners.add(listener)
      return context
    }),
    removeListener: vi.fn((event: string, listener: PageListener) => {
      if (event === 'page') pageListeners.delete(listener)
      return context
    }),
    emitPage: (page: Page) => {
      for (const listener of pageListeners) listener(page)
    }
  })

  return context
}

function fakeMicrosoftPage(context: FakeContext): Page & {
  bringToFront: ReturnType<typeof vi.fn>
} {
  const bringToFront = vi.fn(async () => undefined)
  return {
    context: () => context,
    isClosed: () => false,
    bringToFront
  } as unknown as Page & { bringToFront: ReturnType<typeof vi.fn> }
}

describe('Microsoft Auth V2 recovery continuation', () => {
  it('keeps the Microsoft operator page foreground while mailbox/ad tabs are created', async () => {
    const context = fakeContext()
    const microsoftPage = fakeMicrosoftPage(context)

    await keepMicrosoftForegroundDuring(microsoftPage, async () => {
      context.emitPage({} as Page)
    })

    expect(microsoftPage.bringToFront).toHaveBeenCalledTimes(3)

    context.emitPage({} as Page)
    expect(microsoftPage.bringToFront).toHaveBeenCalledTimes(3)
  })

  it('yields stale recovery failure to a newly detected Stay signed in surface', () => {
    expect(shouldYieldRecoveryNeedsAttentionToFreshSurface('recovery_code', 'stay_signed_in')).toBe(true)
    expect(shouldYieldRecoveryNeedsAttentionToFreshSurface('recovery_code', 'security_review')).toBe(true)
  })

  it('keeps a recovery failure terminal when the live surface is unchanged or unreadable', () => {
    expect(shouldYieldRecoveryNeedsAttentionToFreshSurface('recovery_code', 'recovery_code')).toBe(false)
    expect(shouldYieldRecoveryNeedsAttentionToFreshSurface('recovery_email_confirmation', null)).toBe(false)
  })

  it('keeps bounded post-code probing alive through unreadable hydration frames', () => {
    expect(shouldContinueRecoveryPostCodeSettle(null)).toBe(true)
    expect(shouldContinueRecoveryPostCodeSettle('recovery_code')).toBe(true)
    expect(shouldContinueRecoveryPostCodeSettle('stay_signed_in')).toBe(false)
    expect(shouldContinueRecoveryPostCodeSettle('authenticated')).toBe(false)
  })
})
