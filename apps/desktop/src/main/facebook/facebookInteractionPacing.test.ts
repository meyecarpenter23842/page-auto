import { describe, expect, it } from 'vitest'
import type { FileChooser, Keyboard, Locator, Mouse, Page } from 'playwright-core'
import { DEFAULT_APP_SETTINGS } from '../../shared/appSettings'
import {
  createPacedFacebookPage,
  withoutFacebookInteractionPacing
} from './facebookInteractionPacing'

function fakeFacebookPage() {
  const events: string[] = []
  const waits: number[] = []
  let currentUrl = 'https://www.facebook.com/'
  let oneTimeCodeVisible = false

  const locator = {
    click: async () => { events.push('click') },
    fill: async () => { events.push('fill') },
    press: async () => { events.push('locator.press') },
    dispatchEvent: async () => { events.push('dispatchEvent') },
    isVisible: async () => false,
    first() { return this },
    nth() { return this },
    locator() { return this }
  } as unknown as Locator
  const authLocator = {
    ...locator,
    isVisible: async () => oneTimeCodeVisible,
    first() { return this }
  } as unknown as Locator
  const keyboard = {
    press: async () => { events.push('keyboard.press') }
  } as unknown as Keyboard
  const mouse = {
    wheel: async () => { events.push('mouse.wheel') }
  } as unknown as Mouse
  const fileChooser = {
    setFiles: async () => { events.push('filechooser.setFiles') }
  } as unknown as FileChooser
  const page = {
    locator: (selector: string) => selector.includes('approvals_code') ? authLocator : locator,
    getByRole: () => locator,
    keyboard,
    mouse,
    url: () => currentUrl,
    goto: async () => { events.push('goto') },
    waitForEvent: async () => fileChooser,
    waitForTimeout: async (delayMs: number) => { waits.push(delayMs) }
  } as unknown as Page
  return {
    page,
    events,
    waits,
    setUrl: (value: string) => { currentUrl = value },
    setOneTimeCodeVisible: (value: boolean) => { oneTimeCodeVisible = value }
  }
}

const fixedBrowserDelay = {
  ...DEFAULT_APP_SETTINGS.browser,
  actionDelayMinMs: 2500,
  actionDelayMaxMs: 2500
}

describe('Facebook common interaction pacing', () => {
  it('paces locator click/fill/press from the common Page wrapper', async () => {
    const fake = fakeFacebookPage()
    const page = createPacedFacebookPage(fake.page, fixedBrowserDelay)

    await page.locator('button').click()
    await page.locator('input').fill('abc')
    await page.locator('input').press('Enter')

    expect(fake.events).toEqual(['click', 'fill', 'locator.press'])
    expect(fake.waits).toEqual([2500, 2500, 2500])
  })

  it('paces keyboard and mouse operations independently', async () => {
    const fake = fakeFacebookPage()
    const page = createPacedFacebookPage(fake.page, fixedBrowserDelay)

    await page.keyboard.press('Enter')
    await page.mouse.wheel(0, 900)

    expect(fake.events).toEqual(['keyboard.press', 'mouse.wheel'])
    expect(fake.waits).toEqual([2500, 2500])
  })

  it('paces Facebook navigation as an operation too', async () => {
    const fake = fakeFacebookPage()
    const page = createPacedFacebookPage(fake.page, fixedBrowserDelay)

    await page.goto('https://www.facebook.com/')

    expect(fake.events).toEqual(['goto'])
    expect(fake.waits).toEqual([2500])
  })

  it('keeps login actions paced even inside a broad auth scope and bypasses only the live TOTP surface', async () => {
    const fake = fakeFacebookPage()
    const page = createPacedFacebookPage(fake.page, fixedBrowserDelay)

    await withoutFacebookInteractionPacing(page, async () => {
      await page.locator('input').fill('user@example.com')
      await page.locator('button').click()
    })
    expect(fake.waits).toEqual([2500, 2500])

    fake.setUrl('https://www.facebook.com/two_step_verification/')
    await withoutFacebookInteractionPacing(page, async () => {
      await page.locator('input').fill('123456')
      await page.locator('button').click()
    })
    expect(fake.waits).toEqual([2500, 2500])
    expect(fake.events).toEqual(['fill', 'click', 'fill', 'click'])
  })

  it('also recognizes an explicit one-time-code input as the narrow auth bypass surface', async () => {
    const fake = fakeFacebookPage()
    const page = createPacedFacebookPage(fake.page, fixedBrowserDelay)
    fake.setOneTimeCodeVisible(true)

    await withoutFacebookInteractionPacing(page, async () => {
      await page.locator('input').fill('123456')
    })

    expect(fake.waits).toEqual([])
    expect(fake.events).toEqual(['fill'])
  })

  it('paces FileChooser.setFiles so upload actions cannot bypass the global delay', async () => {
    const fake = fakeFacebookPage()
    const page = createPacedFacebookPage(fake.page, fixedBrowserDelay)

    const chooser = await page.waitForEvent('filechooser')
    await chooser.setFiles('photo.jpg')

    expect(fake.events).toEqual(['filechooser.setFiles'])
    expect(fake.waits).toEqual([2500])
  })

  it('paces explicit DOM-dispatch interaction boundaries too', async () => {
    const fake = fakeFacebookPage()
    const page = createPacedFacebookPage(fake.page, fixedBrowserDelay)

    await page.locator('button').dispatchEvent('click')

    expect(fake.events).toEqual(['dispatchEvent'])
    expect(fake.waits).toEqual([2500])
  })

  it('keeps pacing state isolated per account runtime Page', async () => {
    const first = fakeFacebookPage()
    const second = fakeFacebookPage()
    const pageA = createPacedFacebookPage(first.page, fixedBrowserDelay)
    const pageB = createPacedFacebookPage(second.page, fixedBrowserDelay)

    await Promise.all([
      pageA.locator('button').click(),
      pageB.locator('button').click()
    ])

    expect(first.waits).toEqual([2500])
    expect(second.waits).toEqual([2500])
    expect(first.events).toEqual(['click'])
    expect(second.events).toEqual(['click'])
  })
})
