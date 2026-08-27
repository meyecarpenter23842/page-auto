import { describe, expect, it, vi } from 'vitest'
import type { Locator } from 'playwright-core'
import {
  choosePageWallAdvanceCandidateStrategy,
  isPageWallOptionalCtaPromptOwned,
  waitForPageWallFinalPublishStage,
  waitForPageWallPublishStage,
  type PageWallAdvanceCandidateResolution,
  type PageWallOptionalCtaPromptResolution
} from './pageWallPublishAction'

function advanceResolution(
  strategy: PageWallAdvanceCandidateResolution['strategy'] = 'scoped-role'
): PageWallAdvanceCandidateResolution {
  return {
    button: {} as Locator,
    strategy,
    counts: {
      scopedRoleVisible: strategy === 'scoped-role' ? 1 : 0,
      scopedAriaVisible: strategy === 'scoped-aria' ? 1 : 0,
      pageRoleVisible: strategy === 'page-unique-role' ? 1 : 0,
      pageAriaVisible: strategy === 'page-unique-aria' ? 1 : 0,
      scopedRoleEnabled: strategy === 'scoped-role' ? 1 : 0,
      scopedAriaEnabled: strategy === 'scoped-aria' ? 1 : 0,
      pageRoleEnabled: strategy === 'page-unique-role' ? 1 : 0,
      pageAriaEnabled: strategy === 'page-unique-aria' ? 1 : 0
    }
  }
}

function optionalCtaResolution(owned = true): PageWallOptionalCtaPromptResolution {
  return {
    dismissButton: owned ? {} as Locator : null,
    titleVisible: owned ? 1 : 0,
    addButtonEnabled: owned ? 1 : 0,
    dismissButtonEnabled: owned ? 1 : 0
  }
}

describe('Page Wall composer advance ownership', () => {
  it('prefers exactly one Next/Tiếp theo inside the active composer', () => {
    expect(choosePageWallAdvanceCandidateStrategy(1, 0, 1, 0)).toBe('scoped-role')
    expect(choosePageWallAdvanceCandidateStrategy(0, 1, 1, 0)).toBe('scoped-aria')
  })

  it('allows one unique page-wide advance button for a portaled composer footer', () => {
    expect(choosePageWallAdvanceCandidateStrategy(0, 0, 1, 0)).toBe('page-unique-role')
    expect(choosePageWallAdvanceCandidateStrategy(0, 0, 0, 1)).toBe('page-unique-aria')
  })

  it('refuses ambiguous Next/Tiếp theo controls instead of guessing', () => {
    expect(choosePageWallAdvanceCandidateStrategy(2, 0, 1, 0)).toBe('none')
    expect(choosePageWallAdvanceCandidateStrategy(0, 2, 1, 0)).toBe('none')
    expect(choosePageWallAdvanceCandidateStrategy(0, 0, 2, 0)).toBe('none')
    expect(choosePageWallAdvanceCandidateStrategy(0, 0, 0, 2)).toBe('none')
  })
})

describe('Page Wall publish stage selection', () => {
  it('selects the Next step when Post is not exposed yet', async () => {
    const sleep = vi.fn(async () => undefined)
    const stage = await waitForPageWallPublishStage(
      async () => false,
      async () => advanceResolution(),
      1_000,
      sleep
    )

    expect(stage?.kind).toBe('advance')
  })

  it('prefers a ready final Post control over an incidental Next control', async () => {
    const advanceProbe = vi.fn(async () => advanceResolution('page-unique-role'))
    const stage = await waitForPageWallPublishStage(
      async () => true,
      advanceProbe,
      1_000,
      async () => undefined
    )

    expect(stage).toEqual({ kind: 'publish' })
    expect(advanceProbe).not.toHaveBeenCalled()
  })

  it('keeps polling until the two-step composer exposes Next', async () => {
    let probes = 0
    const stage = await waitForPageWallPublishStage(
      async () => false,
      async () => {
        probes += 1
        if (probes < 4) {
          return {
            button: null,
            strategy: 'none',
            counts: {
              scopedRoleVisible: 0,
              scopedAriaVisible: 0,
              pageRoleVisible: 0,
              pageAriaVisible: 0,
              scopedRoleEnabled: 0,
              scopedAriaEnabled: 0,
              pageRoleEnabled: 0,
              pageAriaEnabled: 0
            }
          }
        }
        return advanceResolution()
      },
      1_000,
      async () => undefined
    )

    expect(stage?.kind).toBe('advance')
    expect(probes).toBe(4)
  })
})

describe('Page Wall optional CTA ownership', () => {
  it('requires the known title plus exactly one Add Button and one Not now action', () => {
    expect(isPageWallOptionalCtaPromptOwned(1, 1, 1)).toBe(true)
    expect(isPageWallOptionalCtaPromptOwned(0, 1, 1)).toBe(false)
    expect(isPageWallOptionalCtaPromptOwned(1, 0, 1)).toBe(false)
    expect(isPageWallOptionalCtaPromptOwned(1, 1, 0)).toBe(false)
    expect(isPageWallOptionalCtaPromptOwned(1, 2, 1)).toBe(false)
    expect(isPageWallOptionalCtaPromptOwned(1, 1, 2)).toBe(false)
  })

  it('dismisses the owned CTA before trusting a Post control that may be visible behind the modal', async () => {
    const publishProbe = vi.fn(async () => true)
    const stage = await waitForPageWallFinalPublishStage(
      async () => optionalCtaResolution(true),
      publishProbe,
      1_000,
      async () => undefined
    )

    expect(stage?.kind).toBe('optional-cta')
    expect(publishProbe).not.toHaveBeenCalled()
  })

  it('continues directly to Post when the optional CTA is absent', async () => {
    const stage = await waitForPageWallFinalPublishStage(
      async () => optionalCtaResolution(false),
      async () => true,
      1_000,
      async () => undefined
    )

    expect(stage).toEqual({ kind: 'publish' })
  })

  it('keeps polling until the optional CTA appears after Next', async () => {
    let probes = 0
    const stage = await waitForPageWallFinalPublishStage(
      async () => {
        probes += 1
        return optionalCtaResolution(probes >= 3)
      },
      async () => false,
      1_000,
      async () => undefined
    )

    expect(stage?.kind).toBe('optional-cta')
    expect(probes).toBe(3)
  })
})
