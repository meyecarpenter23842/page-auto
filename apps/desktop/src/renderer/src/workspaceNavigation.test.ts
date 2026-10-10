import { describe, expect, it } from 'vitest'
import {
  confirmWorkspaceNavigation,
  hasUnsavedWorkspaceChanges,
  readLastWorkspaceRoute,
  registerUnsavedWorkspace,
  saveLastWorkspaceRoute
} from './workspaceNavigation'

describe('workspace navigation guard', () => {
  it('uses Page Tabs by default and rejects unknown persisted routes', () => {
    const routes = ['page-tabs', 'accounts', 'settings'] as const
    expect(readLastWorkspaceRoute(routes, 'page-tabs', { getItem: () => null })).toBe('page-tabs')
    expect(readLastWorkspaceRoute(routes, 'page-tabs', { getItem: () => 'removed-route' })).toBe('page-tabs')
    expect(readLastWorkspaceRoute(routes, 'page-tabs', { getItem: () => 'settings' })).toBe('settings')
  })

  it('persists a valid route and tolerates unavailable storage', () => {
    const values: Record<string, string> = {}
    saveLastWorkspaceRoute('accounts', { setItem: (key, value) => { values[key] = value } })
    expect(readLastWorkspaceRoute(['page-tabs', 'accounts'], 'page-tabs', {
      getItem: (key) => values[key] ?? null
    })).toBe('accounts')
    expect(readLastWorkspaceRoute(['page-tabs'], 'page-tabs', { getItem: () => { throw Error('blocked') } })).toBe('page-tabs')
    expect(() => saveLastWorkspaceRoute('accounts', { setItem: () => { throw Error('blocked') } })).not.toThrow()
  })

  it('only asks for confirmation when a workspace has pending edits', () => {
    expect(confirmWorkspaceNavigation(() => false)).toBe(true)
    const release = registerUnsavedWorkspace('Page Tabs')
    try {
      expect(hasUnsavedWorkspaceChanges()).toBe(true)
      expect(confirmWorkspaceNavigation(() => false)).toBe(false)
      let message = ''
      expect(confirmWorkspaceNavigation((text) => { message = text; return true })).toBe(true)
      expect(message).toContain('Page Tabs')
    } finally {
      release()
    }
    expect(hasUnsavedWorkspaceChanges()).toBe(false)
  })

  it('keeps independent dirty scopes until each one is cleaned up', () => {
    const releaseA = registerUnsavedWorkspace('Page Tabs')
    const releaseB = registerUnsavedWorkspace('Thư viện')
    releaseA()
    expect(hasUnsavedWorkspaceChanges()).toBe(true)
    releaseB()
    expect(hasUnsavedWorkspaceChanges()).toBe(false)
  })
})
