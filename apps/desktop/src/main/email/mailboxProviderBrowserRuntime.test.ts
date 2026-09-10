import { describe, expect, it, vi } from 'vitest'
import type { Browser, BrowserContext } from 'playwright-core'
import {
  configureMailboxProviderBrowser,
  mailboxProviderIsolationConfigured,
  resolveMailboxProviderContext
} from './mailboxProviderBrowserRuntime'

type CloseListener = () => void

type FakeContext = BrowserContext & {
  emitClose: () => void
}

function fakeContext(): FakeContext {
  const closeListeners = new Set<CloseListener>()
  const context = {
    once: vi.fn((event: string, listener: CloseListener) => {
      if (event === 'close') closeListeners.add(listener)
      return context
    }),
    emitClose: () => {
      for (const listener of [...closeListeners]) listener()
      closeListeners.clear()
    }
  } as unknown as FakeContext
  return context
}

function fakeBrowser(context: BrowserContext): Browser & {
  close: ReturnType<typeof vi.fn>
} {
  const close = vi.fn(async () => undefined)
  return {
    newContext: vi.fn(async () => context),
    once: vi.fn(() => undefined),
    close
  } as unknown as Browser & { close: ReturnType<typeof vi.fn> }
}

describe('mailbox provider browser isolation', () => {
  it('keeps direct callers on their supplied context until Auth V2 configures isolation', async () => {
    const operator = fakeContext()
    expect(mailboxProviderIsolationConfigured(operator)).toBe(false)
    expect(await resolveMailboxProviderContext(operator)).toBe(operator)
  })

  it('reuses one visible provider context and never falls back to the Microsoft operator context', async () => {
    const operator = fakeContext()
    const providerContext = fakeContext()
    const browser = fakeBrowser(providerContext)
    const launchBrowser = vi.fn(async () => browser)

    configureMailboxProviderBrowser(operator, {
      executablePath: 'C:\\Chrome\\chrome.exe',
      proxy: { server: 'http://127.0.0.1:8080' },
      launchBrowser
    })

    const first = await resolveMailboxProviderContext(operator)
    const second = await resolveMailboxProviderContext(operator)

    expect(first).toBe(providerContext)
    expect(second).toBe(providerContext)
    expect(first).not.toBe(operator)
    expect(launchBrowser).toHaveBeenCalledTimes(1)
    expect(launchBrowser).toHaveBeenCalledWith({
      executablePath: 'C:\\Chrome\\chrome.exe',
      headless: false,
      proxy: { server: 'http://127.0.0.1:8080' }
    })
  })

  it('fails closed when isolation is configured without a browser executable', async () => {
    const operator = fakeContext()
    const launchBrowser = vi.fn()

    configureMailboxProviderBrowser(operator, { launchBrowser })

    expect(mailboxProviderIsolationConfigured(operator)).toBe(true)
    expect(await resolveMailboxProviderContext(operator)).toBeNull()
    expect(launchBrowser).not.toHaveBeenCalled()
  })

  it('fails closed before launch when a live attached profile has no reproducible proxy config', async () => {
    const operator = fakeContext()
    const launchBrowser = vi.fn()
    const hasLiveCdpEndpoint = vi.fn(async () => true)

    configureMailboxProviderBrowser(operator, {
      executablePath: 'C:\\Chrome\\chrome.exe',
      profileDirectory: 'C:\\Profiles\\Email-1',
      launchBrowser,
      hasLiveCdpEndpoint
    })

    expect(await resolveMailboxProviderContext(operator)).toBeNull()
    expect(hasLiveCdpEndpoint).toHaveBeenCalledWith('C:\\Profiles\\Email-1')
    expect(launchBrowser).not.toHaveBeenCalled()
  })

  it('reproduces an explicit proxy without probing the external boundary', async () => {
    const operator = fakeContext()
    const providerContext = fakeContext()
    const browser = fakeBrowser(providerContext)
    const launchBrowser = vi.fn(async () => browser)
    const hasLiveCdpEndpoint = vi.fn(async () => true)

    configureMailboxProviderBrowser(operator, {
      executablePath: 'C:\\Chrome\\chrome.exe',
      profileDirectory: 'C:\\Profiles\\Email-1',
      proxy: { server: 'http://127.0.0.1:8080' },
      launchBrowser,
      hasLiveCdpEndpoint
    })

    expect(await resolveMailboxProviderContext(operator)).toBe(providerContext)
    expect(hasLiveCdpEndpoint).not.toHaveBeenCalled()
    expect(launchBrowser).toHaveBeenCalledWith({
      executablePath: 'C:\\Chrome\\chrome.exe',
      headless: false,
      proxy: { server: 'http://127.0.0.1:8080' }
    })
  })

  it('closes the visible provider browser when the Microsoft operator context closes', async () => {
    const operator = fakeContext()
    const providerContext = fakeContext()
    const browser = fakeBrowser(providerContext)

    configureMailboxProviderBrowser(operator, {
      executablePath: 'C:\\Chrome\\chrome.exe',
      launchBrowser: async () => browser
    })
    expect(await resolveMailboxProviderContext(operator)).toBe(providerContext)

    operator.emitClose()
    await Promise.resolve()
    await Promise.resolve()

    expect(browser.close).toHaveBeenCalledTimes(1)
  })
})
