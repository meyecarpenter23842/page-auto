import type { Locator, Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { pollActionVerificationState } from '../actionVerification'
import { visibleSubmittedTextCount } from './actionSupport'
import { reactToComment, replyToComment } from './commentInteractionActionSupport'
import { commentAtVisibleBox } from './friendActionSupport'
import { commentOnGroupArticle } from './groupInteractionActionSupport'

function locatorList(items: Locator[]): Locator {
  const fallback = {
    count: async () => 0,
    nth: () => fallback,
    first: () => fallback,
    last: () => fallback,
    isVisible: async () => false
  } as unknown as Locator
  return {
    count: async () => items.length,
    nth: (index: number) => items[index] ?? fallback,
    first: () => items[0] ?? fallback,
    last: () => items[items.length - 1] ?? fallback
  } as unknown as Locator
}

function renderedTextCandidate(rendered: boolean): Locator {
  return {
    isVisible: async () => true,
    evaluate: async () => rendered
  } as unknown as Locator
}

function emptyLocator(): Locator {
  return locatorList([])
}

function makeCommentSurface(options: {
  renderAfterEnter: boolean
  replyButton?: boolean
}): { page: Page; article: Locator; rendered: () => number } {
  let rendered = 0
  const box = {
    isVisible: async () => true,
    fill: async () => undefined,
    press: async () => {
      if (options.renderAfterEnter) rendered += 1
    }
  } as unknown as Locator
  const reply = {
    isVisible: async () => true,
    click: async () => undefined
  } as unknown as Locator

  const textMatches = () => locatorList(Array.from({ length: rendered }, () => renderedTextCandidate(true)))
  const article = {
    locator: (selector: string) => {
      if (selector.includes('contenteditable')) return locatorList([box])
      if (options.replyButton && /Reply|Trả lời/.test(selector)) return locatorList([reply])
      return emptyLocator()
    },
    getByText: () => textMatches(),
    getByRole: () => emptyLocator()
  } as unknown as Locator
  const page = {
    locator: (selector: string) => selector.includes('contenteditable') ? locatorList([box]) : emptyLocator(),
    getByText: () => textMatches(),
    getByRole: () => emptyLocator(),
    waitForTimeout: async () => undefined
  } as unknown as Page

  return { page, article, rendered: () => rendered }
}

function makeReactionSurface(appliesAfterClick: boolean): { page: Page; article: Locator } {
  let clicked = false
  const like = {
    isVisible: async () => true,
    click: async () => {
      clicked = true
    }
  } as unknown as Locator
  const applied = {
    isVisible: async () => true
  } as unknown as Locator
  const article = {
    locator: (selector: string) => {
      if (selector.includes('aria-label="Like"')) return locatorList([like])
      if (selector.includes('aria-label^="Remove ') && clicked && appliesAfterClick) return locatorList([applied])
      return emptyLocator()
    },
    getByRole: () => emptyLocator(),
    getByText: () => emptyLocator()
  } as unknown as Locator
  const page = {
    locator: () => emptyLocator(),
    getByRole: () => emptyLocator(),
    getByText: () => emptyLocator(),
    waitForTimeout: async () => undefined
  } as unknown as Page
  return { page, article }
}

describe('common post-action verification primitives', () => {
  it('exposes bounded polling for atomic actions without requiring an exact-target revisit', async () => {
    let clock = 0
    let reads = 0
    const state = await pollActionVerificationState(
      async () => {
        reads += 1
        return reads === 3 ? 'applied' : null
      },
      {
        timeoutMs: 1000,
        intervalMs: 100,
        now: () => clock,
        wait: async (delayMs) => {
          clock += delayMs
          return true
        }
      }
    )

    expect(state).toBe('applied')
    expect(reads).toBe(3)
    expect(clock).toBe(200)
  })

  it('does not count text that is still inside a composer as submitted state', async () => {
    const rendered = renderedTextCandidate(true)
    const composer = renderedTextCandidate(false)
    const scope = {
      getByText: () => locatorList([composer, rendered])
    } as unknown as Locator

    await expect(visibleSubmittedTextCount(scope, 'hello')).resolves.toBe(1)
  })
})

describe('comment mutation verification', () => {
  it('does not report a UID comment as success just because Enter resolves', async () => {
    const { page, rendered } = makeCommentSurface({ renderAfterEnter: false })
    await expect(commentAtVisibleBox(page, 'verified comment')).resolves.toBe(false)
    expect(rendered()).toBe(0)
  })

  it('accepts a UID comment only after the rendered comment count increases', async () => {
    const { page, rendered } = makeCommentSurface({ renderAfterEnter: true })
    await expect(commentAtVisibleBox(page, 'verified comment')).resolves.toBe(true)
    expect(rendered()).toBe(1)
  })

  it('does not report a reply as success when the target article never renders it', async () => {
    const { page, article } = makeCommentSurface({ renderAfterEnter: false, replyButton: true })
    await expect(replyToComment(page, article, 'verified reply')).resolves.toBe(false)
  })

  it('accepts a reply after the target article renders a new exact-text occurrence', async () => {
    const { page, article, rendered } = makeCommentSurface({ renderAfterEnter: true, replyButton: true })
    await expect(replyToComment(page, article, 'verified reply')).resolves.toBe(true)
    expect(rendered()).toBe(1)
  })

  it('does not report a Group comment as success when Enter resolves without a DOM mutation', async () => {
    const { page, article } = makeCommentSurface({ renderAfterEnter: false })
    await expect(commentOnGroupArticle(page, article, 'verified group comment', '')).resolves.toBe(false)
  })

  it('accepts a Group comment after the scoped rendered text count increases', async () => {
    const { page, article, rendered } = makeCommentSurface({ renderAfterEnter: true })
    await expect(commentOnGroupArticle(page, article, 'verified group comment', '')).resolves.toBe(true)
    expect(rendered()).toBe(1)
  })
})

describe('comment reaction verification', () => {
  it('does not treat click resolution alone as an applied reaction', async () => {
    const { page, article } = makeReactionSurface(false)
    await expect(reactToComment(page, article, { reactionLike: true })).resolves.toBe(false)
  })

  it('accepts the reaction after the target comment exposes an applied state', async () => {
    const { page, article } = makeReactionSurface(true)
    await expect(reactToComment(page, article, { reactionLike: true })).resolves.toBe(true)
  })
})
