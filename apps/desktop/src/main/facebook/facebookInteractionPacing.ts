import type { FileChooser, FrameLocator, Keyboard, Locator, Mouse, Page } from 'playwright-core'
import { randomBrowserActionDelayMs, type BrowserSettings } from '../../shared/appSettings'

export type FacebookInteractionBoundary = string
export type FacebookInteractionPace = (boundary: FacebookInteractionBoundary) => Promise<void>

interface FacebookInteractionPaceState {
  suspended: number
}

const PAGE_PACE_STATES = new WeakMap<Page, FacebookInteractionPaceState>()

const LOCATOR_ACTION_METHODS = new Set([
  'click', 'dblclick', 'tap', 'fill', 'clear', 'type', 'pressSequentially', 'press',
  'check', 'uncheck', 'setChecked', 'selectOption', 'setInputFiles', 'hover', 'focus', 'dragTo',
  'dispatchEvent', 'selectText'
])
const PAGE_ACTION_METHODS = new Set([
  'goto', 'reload', 'goBack', 'goForward',
  'click', 'dblclick', 'tap', 'fill', 'type', 'press', 'check', 'uncheck', 'setChecked',
  'selectOption', 'setInputFiles', 'hover', 'focus', 'dragAndDrop'
])
const LOCATOR_FACTORY_METHODS = new Set([
  'locator', 'getByAltText', 'getByLabel', 'getByPlaceholder', 'getByRole', 'getByTestId',
  'getByText', 'getByTitle', 'and', 'or', 'filter', 'first', 'last', 'nth'
])
const PAGE_LOCATOR_FACTORY_METHODS = new Set([
  'locator', 'getByAltText', 'getByLabel', 'getByPlaceholder', 'getByRole', 'getByTestId',
  'getByText', 'getByTitle'
])
const FRAME_LOCATOR_FACTORY_METHODS = new Set([
  'locator', 'getByAltText', 'getByLabel', 'getByPlaceholder', 'getByRole', 'getByTestId',
  'getByText', 'getByTitle'
])
const KEYBOARD_ACTION_METHODS = new Set(['insertText', 'press', 'type', 'down', 'up'])
const MOUSE_ACTION_METHODS = new Set(['click', 'dblclick', 'wheel', 'down', 'up'])
const FILE_CHOOSER_ACTION_METHODS = new Set(['setFiles'])
const TIME_CRITICAL_AUTH_INPUT_SELECTOR = [
  'input[name="approvals_code"]',
  'input[name="approvalsCode"]',
  'input[autocomplete="one-time-code"]',
  'input[name*="otp" i]'
].join(',')

function methodValue(target: object, property: PropertyKey): ((...args: unknown[]) => unknown) | null {
  const value = Reflect.get(target, property, target)
  return typeof value === 'function' ? value as (...args: unknown[]) => unknown : null
}

async function isTimeCriticalAuthenticationSurface(page: Page): Promise<boolean> {
  if (page.url().toLowerCase().includes('/two_step_verification/')) return true
  return page.locator(TIME_CRITICAL_AUTH_INPUT_SELECTOR).first().isVisible().catch(() => false)
}

function wrapFrameLocator(frameLocator: FrameLocator, pace: FacebookInteractionPace): FrameLocator {
  return new Proxy(frameLocator, {
    get(target, property) {
      const method = methodValue(target, property)
      if (!method) return Reflect.get(target, property, target)
      const name = String(property)
      if (FRAME_LOCATOR_FACTORY_METHODS.has(name)) {
        return (...args: unknown[]) => wrapLocator(Reflect.apply(method, target, args) as Locator, pace)
      }
      if (name === 'owner') {
        return (...args: unknown[]) => wrapLocator(Reflect.apply(method, target, args) as Locator, pace)
      }
      return method.bind(target)
    }
  })
}

function wrapLocator(locator: Locator, pace: FacebookInteractionPace): Locator {
  return new Proxy(locator, {
    get(target, property) {
      const method = methodValue(target, property)
      if (!method) return Reflect.get(target, property, target)
      const name = String(property)

      if (LOCATOR_ACTION_METHODS.has(name)) {
        return async (...args: unknown[]) => {
          await pace(`locator.${name}`)
          return Reflect.apply(method, target, args)
        }
      }
      if (LOCATOR_FACTORY_METHODS.has(name)) {
        return (...args: unknown[]) => wrapLocator(Reflect.apply(method, target, args) as Locator, pace)
      }
      if (name === 'contentFrame') {
        return (...args: unknown[]) => wrapFrameLocator(Reflect.apply(method, target, args) as FrameLocator, pace)
      }
      return method.bind(target)
    }
  })
}

function wrapKeyboard(keyboard: Keyboard, pace: FacebookInteractionPace): Keyboard {
  return new Proxy(keyboard, {
    get(target, property) {
      const method = methodValue(target, property)
      if (!method) return Reflect.get(target, property, target)
      const name = String(property)
      if (KEYBOARD_ACTION_METHODS.has(name)) {
        return async (...args: unknown[]) => {
          await pace(`keyboard.${name}`)
          return Reflect.apply(method, target, args)
        }
      }
      return method.bind(target)
    }
  })
}

function wrapMouse(mouse: Mouse, pace: FacebookInteractionPace): Mouse {
  return new Proxy(mouse, {
    get(target, property) {
      const method = methodValue(target, property)
      if (!method) return Reflect.get(target, property, target)
      const name = String(property)
      if (MOUSE_ACTION_METHODS.has(name)) {
        return async (...args: unknown[]) => {
          await pace(`mouse.${name}`)
          return Reflect.apply(method, target, args)
        }
      }
      return method.bind(target)
    }
  })
}

function wrapFileChooser(fileChooser: FileChooser, pace: FacebookInteractionPace): FileChooser {
  return new Proxy(fileChooser, {
    get(target, property) {
      const method = methodValue(target, property)
      if (!method) return Reflect.get(target, property, target)
      const name = String(property)
      if (FILE_CHOOSER_ACTION_METHODS.has(name)) {
        return async (...args: unknown[]) => {
          await pace(`filechooser.${name}`)
          return Reflect.apply(method, target, args)
        }
      }
      return method.bind(target)
    }
  })
}

export function createFacebookInteractionPace(
  page: Page,
  browser: BrowserSettings,
  diagnostic?: (message: string) => void,
  state: FacebookInteractionPaceState = { suspended: 0 }
): FacebookInteractionPace {
  return async (boundary) => {
    if (state.suspended > 0 && await isTimeCriticalAuthenticationSurface(page)) {
      diagnostic?.(`interaction=${boundary} delay=bypassed reason=time-critical-auth`)
      return
    }
    const delayMs = randomBrowserActionDelayMs(browser)
    if (delayMs <= 0) return
    diagnostic?.(`interaction=${boundary} delayMs=${delayMs}`)
    await page.waitForTimeout(delayMs)
  }
}

/**
 * Request a pacing bypass for a short-lived authentication credential. The common pacing layer only
 * honors the request while Facebook is actually on a TOTP/one-time-code surface; login navigation,
 * password entry and every normal Facebook business action keep the operator-configured delay.
 */
export async function withoutFacebookInteractionPacing<T>(page: Page, run: () => Promise<T>): Promise<T> {
  const state = PAGE_PACE_STATES.get(page)
  if (!state) return run()
  state.suspended += 1
  try {
    return await run()
  } finally {
    state.suspended = Math.max(0, state.suspended - 1)
  }
}

/**
 * Facebook Common Runtime exposes this Page to every Facebook business flow.
 * Read/probe operations stay immediate; navigation and consequential UI operations use the single
 * operator-configured browser-action delay. Each account owns its own runtime/Page, so concurrent
 * accounts pace independently.
 */
export function createPacedFacebookPage(
  page: Page,
  browser: BrowserSettings,
  diagnostic?: (message: string) => void
): Page {
  const state: FacebookInteractionPaceState = { suspended: 0 }
  const pace = createFacebookInteractionPace(page, browser, diagnostic, state)
  const wrappedKeyboard = wrapKeyboard(page.keyboard, pace)
  const wrappedMouse = wrapMouse(page.mouse, pace)

  const wrappedPage = new Proxy(page, {
    get(target, property) {
      if (property === 'keyboard') return wrappedKeyboard
      if (property === 'mouse') return wrappedMouse

      const method = methodValue(target, property)
      if (!method) return Reflect.get(target, property, target)
      const name = String(property)

      if (PAGE_ACTION_METHODS.has(name)) {
        return async (...args: unknown[]) => {
          await pace(`page.${name}`)
          return Reflect.apply(method, target, args)
        }
      }
      if (PAGE_LOCATOR_FACTORY_METHODS.has(name)) {
        return (...args: unknown[]) => wrapLocator(Reflect.apply(method, target, args) as Locator, pace)
      }
      if (name === 'frameLocator') {
        return (...args: unknown[]) => wrapFrameLocator(Reflect.apply(method, target, args) as FrameLocator, pace)
      }
      if (name === 'waitForEvent') {
        return async (...args: unknown[]) => {
          const result = await Reflect.apply(method, target, args)
          return args[0] === 'filechooser' && result
            ? wrapFileChooser(result as FileChooser, pace)
            : result
        }
      }
      return method.bind(target)
    }
  })
  PAGE_PACE_STATES.set(wrappedPage, state)
  return wrappedPage
}
