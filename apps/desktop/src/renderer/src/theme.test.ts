import { describe, expect, it, vi } from 'vitest'
import { APP_THEME_STORAGE_KEY, readStoredTheme, saveTheme } from './theme'

describe('renderer theme preference', () => {
  it('keeps the existing light UI as the default for missing or invalid preferences', () => {
    expect(readStoredTheme({ getItem: () => null })).toBe('light')
    expect(readStoredTheme({ getItem: () => 'system' })).toBe('light')
  })

  it('restores a persisted dark preference', () => {
    expect(readStoredTheme({ getItem: () => 'dark' })).toBe('dark')
  })

  it('persists a theme without requiring Main or the database', () => {
    const setItem = vi.fn()
    saveTheme('dark', { setItem })
    expect(setItem).toHaveBeenCalledWith(APP_THEME_STORAGE_KEY, 'dark')
  })

  it('falls back safely when preference storage throws', () => {
    expect(readStoredTheme({ getItem: () => { throw new Error('blocked') } })).toBe('light')
    expect(() => saveTheme('dark', { setItem: () => { throw new Error('blocked') } })).not.toThrow()
  })
})
