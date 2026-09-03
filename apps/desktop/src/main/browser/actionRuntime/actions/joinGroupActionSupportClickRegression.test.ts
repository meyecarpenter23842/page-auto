import { describe, expect, it, vi } from 'vitest'
import type { Locator, Page } from 'playwright-core'
import type { ActionExecutorContext } from '../../../services/actionRunner'
import { submitJoinAttempt } from './joinGroupActionSupport'

function emptyLocator(): Locator {
  const empty = {
    count: async () => 0,
    isVisible: async () => false,
    first() { return this },
    nth() { return this },
    locator() { return this },
    getAttribute: async () => null,
    innerText: async () => ''
  }
  return empty as unknown as Locator
}

function runtime(input: {
  playwrightEffect?: () => void
  domEffect?: () => void
  initialButtonVisible?: boolean
}) {
  const empty = emptyLocator()
  let joined = false
  let buttonVisible = input.initialButtonVisible ?? true
  let dialogVisible = false
  let playwrightClicks = 0
  let domClicks = 0

  const joinedLocator = {
    count: async () => joined ? 1 : 0,
    isVisible: async () => joined,
    first() { return this },
    nth() { return this },
    locator: () => empty,
    getAttribute: async () => null,
    innerText: async () => joined ? 'Joined' : ''
  } as unknown as Locator

  const dialogLocator = {
    count: async () => dialogVisible ? 1 : 0,
    isVisible: async () => dialogVisible,
    first() { return this },
    nth() { return this },
    locator: () => empty,
    innerText: async () => dialogVisible ? 'Join group' : ''
  } as unknown as Locator

  const page = {
    url: () => 'https://www.facebook.com/groups/499972071052177/',
    locator: (selector: string) => {
      if (selector === '[role="dialog"]') return dialogLocator
      if (selector.includes('Joined') || selector.includes('Đã tham gia')) return joinedLocator
      return empty
    }
  } as unknown as Page

  const button = {
    click: async () => {
      playwrightClicks += 1
      input.playwrightEffect?.()
    },
    evaluate: async () => {
      domClicks += 1
      input.domEffect?.()
      return true
    },
    isVisible: async () => buttonVisible,
    locator: () => empty,
    innerText: async () => 'Join group'
  } as unknown as Locator

  const log = vi.fn()
  const context = {
    control: {
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      sleep: async () => undefined
    },
    log
  } as unknown as ActionExecutorContext

  return {
    page,
    button,
    context,
    log,
    setJoined: (value: boolean) => { joined = value },
    setButtonVisible: (value: boolean) => { buttonVisible = value },
    setDialogVisible: (value: boolean) => { dialogVisible = value },
    playwrightClicks: () => playwrightClicks,
    domClicks: () => domClicks
  }
}

describe('K4.3.1 live Join click-effect regression', () => {
  it('uses one DOM click fallback when Playwright resolves but the exact same Join control stays visible with no state transition', async () => {
    let harness: ReturnType<typeof runtime>
    harness = runtime({
      domEffect: () => harness.setJoined(true)
    })

    const outcome = await submitJoinAttempt(harness.page, harness.button, harness.context, {})

    expect(outcome).toBe('joined')
    expect(harness.playwrightClicks()).toBe(1)
    expect(harness.domClicks()).toBe(1)
    expect(harness.log).toHaveBeenCalledWith(
      'debug',
      expect.stringContaining('DOM click'),
      'join_group_click_dom_fallback',
      expect.objectContaining({ targetIdentity: '499972071052177' })
    )
  })

  it('does not DOM-click again when the first Playwright click already produces Joined', async () => {
    let harness: ReturnType<typeof runtime>
    harness = runtime({
      playwrightEffect: () => harness.setJoined(true)
    })

    const outcome = await submitJoinAttempt(harness.page, harness.button, harness.context, {})

    expect(outcome).toBe('joined')
    expect(harness.playwrightClicks()).toBe(1)
    expect(harness.domClicks()).toBe(0)
  })

  it('does not retry the consequential click when the Join control disappears without a confirmed membership state', async () => {
    let harness: ReturnType<typeof runtime>
    harness = runtime({
      playwrightEffect: () => harness.setButtonVisible(false)
    })

    const outcome = await submitJoinAttempt(harness.page, harness.button, harness.context, {})

    expect(outcome).toBe('unverified')
    expect(harness.playwrightClicks()).toBe(1)
    expect(harness.domClicks()).toBe(0)
  })

  it('does not retry the original Join control when the first click opens a membership dialog', async () => {
    let harness: ReturnType<typeof runtime>
    harness = runtime({
      playwrightEffect: () => harness.setDialogVisible(true)
    })

    const outcome = await submitJoinAttempt(harness.page, harness.button, harness.context, {})

    expect(outcome).toBe('unverified')
    expect(harness.playwrightClicks()).toBe(1)
    expect(harness.domClicks()).toBe(0)
  })
})
