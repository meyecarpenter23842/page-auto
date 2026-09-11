import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserContext, Page } from 'playwright-core'
import { classifyMicrosoftLoginSurface } from './emailLoginPolicy'
import {
  fviaMessageDetailMatchesSummary,
  isAmbiguousFviaMessageContainerText
} from './fviaInboxesPlaywrightDriver'
import { bindMailboxProviderForegroundGuard } from './mailboxProviderBrowserRuntime'
import type { FviaInboxesMessageSummary } from './fviaInboxesProvider'

type PageListener = (page: Page) => void

type ProviderContext = BrowserContext & {
  emitPage: (page: Page) => void
}

function fakeOperatorContext(bringToFront: ReturnType<typeof vi.fn>): BrowserContext {
  const operatorPage = {
    isClosed: () => false,
    bringToFront
  } as unknown as Page
  return {
    pages: () => [operatorPage]
  } as unknown as BrowserContext
}

function fakeProviderContext(): ProviderContext {
  const listeners = new Set<PageListener>()
  const context = {
    on: vi.fn((event: string, listener: PageListener) => {
      if (event === 'page') listeners.add(listener)
      return context
    }),
    emitPage: (page: Page) => {
      for (const listener of listeners) listener(page)
    }
  } as unknown as ProviderContext
  return context
}

function fviaSummary(subject: string): FviaInboxesMessageSummary {
  return {
    key: `text:${subject.toLowerCase()}`,
    sender: 'account-security-noreply',
    subject,
    preview: subject,
    receivedLabel: 'just now',
    receivedAt: null
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Microsoft/Fvia live login regressions 2026-09-11', () => {
  it('keeps the actionable Verify your email form on recovery even when password fallback is visible', () => {
    expect(classifyMicrosoftLoginSurface({
      url: 'https://login.live.com/oauth20_authorize.srf',
      text: "Verify your email We'll send a code to tv*****@fviainboxes.com. To verify this is your email address, enter it here. Send code. Other ways to sign in. Use your password",
      emailInputCount: 1,
      usernameInputCount: 0,
      proofEmailInputCount: 1,
      verificationCodeInputCount: 0,
      passwordInputCount: 0,
      sendCodeControlCount: 1,
      usePasswordControlCount: 1
    })).toBe('recovery_email_confirmation')
  })

  it('still recognizes a real Sign in another way chooser as password method choice', () => {
    expect(classifyMicrosoftLoginSurface({
      url: 'https://login.live.com/oauth20_authorize.srf',
      text: 'Sign in another way Use your password Send a code to tv*****@fviainboxes.com Show more options',
      emailInputCount: 0,
      usernameInputCount: 0,
      proofEmailInputCount: 0,
      verificationCodeInputCount: 0,
      passwordInputCount: 0,
      sendCodeControlCount: 1,
      usePasswordControlCount: 1
    })).toBe('password_method_choice')
  })

  it('rejects a composite Fvia DOM container that mixes the new security-code row with an older unusual-sign-in row', () => {
    expect(isAmbiguousFviaMessageContainerText(
      'account-security-noreply just now Personal Microsoft account security code account-security-noreply 1m ago Microsoft account unusual sign-in activity'
    )).toBe(true)

    expect(isAmbiguousFviaMessageContainerText(
      'account-security-noreply just now Personal Microsoft account security code'
    )).toBe(false)
    expect(isAmbiguousFviaMessageContainerText(
      'account-security-noreply 1m ago Microsoft account unusual sign-in activity'
    )).toBe(false)
  })

  it('accepts the live Fvia Security code detail even when it does not repeat the list-row subject verbatim', () => {
    const security = fviaSummary('Personal Microsoft account security code')
    expect(fviaMessageDetailMatchesSummary(
      security,
      'Microsoft account Security code Please use the following security code for your personal Microsoft account. Security code: 400045 Thanks, The Microsoft account team'
    )).toBe(true)

    expect(fviaMessageDetailMatchesSummary(
      security,
      'Microsoft account Unusual sign-in activity We detected something unusual about a recent sign-in.'
    )).toBe(false)
  })

  it('restores the Microsoft operator window when the isolated headed provider creates a page', async () => {
    vi.useFakeTimers()
    const bringToFront = vi.fn(async () => undefined)
    const operatorContext = fakeOperatorContext(bringToFront)
    const providerContext = fakeProviderContext()

    bindMailboxProviderForegroundGuard(operatorContext, providerContext)
    providerContext.emitPage({} as Page)

    expect(bringToFront).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(120)
    expect(bringToFront).toHaveBeenCalledTimes(2)
  })
})
