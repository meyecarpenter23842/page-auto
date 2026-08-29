import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS, type BrowserSettings } from '../../shared/appSettings'
import {
  FacebookProfileResolutionError,
  appManagedFacebookProfileDirectory,
  resolveFacebookProfileDirectory
} from './facebookProfileResolver'

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'page-auto-facebook-profile-'))
  roots.push(root)
  return root
}

function browserSettings(patch: Partial<BrowserSettings>): BrowserSettings {
  return { ...DEFAULT_APP_SETTINGS.browser, ...patch }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Facebook external profile resolver', () => {
  it('keeps managed mode backward compatible and creates app-owned account profile', () => {
    const dataDirectory = tempRoot()
    const result = resolveFacebookProfileDirectory(
      dataDirectory,
      { id: 17, uid: '100017' },
      browserSettings({ profileStorageMode: 'managed' })
    )

    expect(result.mode).toBe('managed')
    expect(result.profileDirectory).toBe(appManagedFacebookProfileDirectory(dataDirectory, 17))
    expect(existsSync(result.profileDirectory)).toBe(true)
  })

  it('resolves external mode strictly to Root\\UID without cloning', () => {
    const sandbox = tempRoot()
    const dataDirectory = join(sandbox, 'data')
    const externalRoot = join(sandbox, 'facebook-profiles')
    const uid = '1000123456789'
    const profileDirectory = join(externalRoot, uid)
    mkdirSync(profileDirectory, { recursive: true })

    const result = resolveFacebookProfileDirectory(
      dataDirectory,
      { id: 9, uid },
      browserSettings({ profileStorageMode: 'external', externalProfileRoot: externalRoot })
    )

    expect(result).toEqual({ mode: 'external', profileDirectory })
    expect(existsSync(appManagedFacebookProfileDirectory(dataDirectory, 9))).toBe(false)
  })

  it('fails missing external UID profile and never creates an app-managed fallback', () => {
    const sandbox = tempRoot()
    const dataDirectory = join(sandbox, 'data')
    const externalRoot = join(sandbox, 'facebook-profiles')
    mkdirSync(externalRoot, { recursive: true })

    let caught: unknown
    try {
      resolveFacebookProfileDirectory(
        dataDirectory,
        { id: 21, uid: '100021' },
        browserSettings({ profileStorageMode: 'external', externalProfileRoot: externalRoot })
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(FacebookProfileResolutionError)
    expect((caught as FacebookProfileResolutionError).code).toBe('external_profile_missing')
    expect(existsSync(appManagedFacebookProfileDirectory(dataDirectory, 21))).toBe(false)
  })

  it('rejects UID path traversal in external mode', () => {
    const sandbox = tempRoot()
    const externalRoot = join(sandbox, 'facebook-profiles')
    mkdirSync(externalRoot, { recursive: true })

    expect(() => resolveFacebookProfileDirectory(
      join(sandbox, 'data'),
      { id: 3, uid: '..\\outside' },
      browserSettings({ profileStorageMode: 'external', externalProfileRoot: externalRoot })
    )).toThrowError(FacebookProfileResolutionError)
  })
})
