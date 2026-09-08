import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { createBrowserMailProvider, isBrowserMailProviderId } from './browserMailProviderFactory'

describe('browserMailProviderFactory', () => {
  const page = {} as Page

  it('creates the browser provider selected by the central registry id', () => {
    expect(createBrowserMailProvider('inboxes', page)?.id).toBe('inboxes')
    expect(createBrowserMailProvider('fvia_inboxes', page)?.id).toBe('fvia_inboxes')
  })

  it('fails closed for provider ids that do not have a browser adapter in this batch', () => {
    expect(isBrowserMailProviderId('microsoft')).toBe(false)
    expect(isBrowserMailProviderId('mailto_plus')).toBe(false)
    expect(createBrowserMailProvider('microsoft', page)).toBeNull()
    expect(createBrowserMailProvider('mailto_plus', page)).toBeNull()
  })
})
