import { describe, expect, it } from 'vitest'
import type { BrowserContext, Page } from 'playwright-core'
import { EmailPageRegistry, classifyEmailPageUrl, soleInitialBlankPage } from './emailPageRegistry'

type FakeContext = BrowserContext & { pagesList: Page[]; created: Page[] }

function fakeContext(): FakeContext {
  const pagesList: Page[] = []
  const created: Page[] = []
  const context = {
    pagesList,
    created,
    pages: () => pagesList,
    newPage: async () => {
      const page = fakePage('about:blank', context as FakeContext)
      created.push(page)
      return page
    }
  } as unknown as FakeContext
  return context
}

function fakePage(url: string, context: FakeContext): Page {
  let closed = false
  const page = {
    url: () => url,
    isClosed: () => closed,
    context: () => context,
    close: async () => { closed = true }
  } as unknown as Page
  context.pagesList.push(page)
  return page
}

describe('EmailPageRegistry', () => {
  it('classifies Microsoft, Outlook, provider and unrelated pages explicitly', () => {
    expect(classifyEmailPageUrl('https://login.live.com/oauth20_authorize.srf')).toBe('microsoft_auth')
    expect(classifyEmailPageUrl('https://account.live.com/proofs/manage/additional')).toBe('microsoft_auth')
    expect(classifyEmailPageUrl('https://outlook.live.com/mail/0/inbox')).toBe('outlook_mail')
    expect(classifyEmailPageUrl('https://inboxes.com/')).toBe('mailbox_provider')
    expect(classifyEmailPageUrl('https://fviainboxes.com/')).toBe('mailbox_provider')
    expect(classifyEmailPageUrl('https://tempmail.plus/en/')).toBe('mailbox_provider')
    expect(classifyEmailPageUrl('https://example.com/operator')).toBe('unrelated')
  })

  it('promotes only the sole initial about:blank tab into the visible operator page', async () => {
    const context = fakeContext()
    const initialBlank = fakePage('about:blank', context)
    const registry = new EmailPageRegistry(context)

    expect(soleInitialBlankPage(context.pages())).toBe(initialBlank)
    expect(await registry.resolveOrCreate('outlook_mail')).toBe(initialBlank)
    expect(context.created).toHaveLength(0)
  })

  it('reuses an existing Microsoft operator page when navigating to another Microsoft role', async () => {
    const context = fakeContext()
    const login = fakePage('https://login.live.com/oauth20_authorize.srf', context)
    const registry = new EmailPageRegistry(context)

    const resolved = await registry.resolveOrCreate(
      'microsoft_auth',
      (page) => page.url().includes('/proofs/manage/additional')
    )

    expect(resolved).toBe(login)
    expect(context.created).toHaveLength(0)
  })

  it('never resolves the first provider tab as Outlook merely because it is first', async () => {
    const context = fakeContext()
    const provider = fakePage('https://inboxes.com/', context)
    const outlook = fakePage('https://outlook.live.com/mail/0/inbox', context)
    const registry = new EmailPageRegistry(context)

    const resolved = await registry.resolveOrCreate('outlook_mail')

    expect(resolved).toBe(outlook)
    expect(resolved).not.toBe(provider)
    expect(context.created).toHaveLength(0)
  })

  it('creates a fresh page instead of hijacking provider or unrelated tabs', async () => {
    const context = fakeContext()
    const provider = fakePage('https://inboxes.com/', context)
    const operator = fakePage('https://example.com/operator', context)
    const registry = new EmailPageRegistry(context)

    const resolved = await registry.resolveOrCreate('outlook_mail')

    expect(resolved).not.toBe(provider)
    expect(resolved).not.toBe(operator)
    expect(context.created).toEqual([resolved])
  })

  it('does not promote a blank tab once another live tab already exists', () => {
    const context = fakeContext()
    fakePage('about:blank', context)
    fakePage('https://example.com/operator', context)

    expect(soleInitialBlankPage(context.pages())).toBeNull()
  })

  it('resolves a Microsoft action page by target evidence independent of tab order', async () => {
    const context = fakeContext()
    fakePage('https://inboxes.com/', context)
    const password = fakePage('https://account.live.com/password/Change', context)
    fakePage('https://example.com/operator', context)
    const registry = new EmailPageRegistry(context)

    const resolved = await registry.resolveMicrosoftActionPage((page) => page.url().includes('/password/Change'))

    expect(resolved).toBe(password)
    expect(context.created).toHaveLength(0)
  })

  it('falls back to an existing Microsoft page after a manual action navigates away from its original target', async () => {
    const context = fakeContext()
    const provider = fakePage('https://inboxes.com/', context)
    const completed = fakePage('https://account.live.com/', context)
    const registry = new EmailPageRegistry(context)

    const resolved = await registry.resolveMicrosoftActionPage((page) => page.url().includes('/password/Change'))

    expect(resolved).toBe(completed)
    expect(resolved).not.toBe(provider)
    expect(context.created).toHaveLength(0)
  })

  it('invalidates closed pages instead of returning stale ownership', () => {
    const context = fakeContext()
    const page = fakePage('https://outlook.live.com/mail/0/inbox', context)
    const registry = new EmailPageRegistry(context)

    void page.close()

    expect(registry.newest('outlook_mail')).toBeNull()
  })
})
