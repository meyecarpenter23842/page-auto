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

describe('Facebook profile root resolver', () => {
  it('always resolves the selected Root\\UID even when legacy settings still say managed', () => {
    const sandbox = tempRoot()
    const dataDirectory = join(sandbox, 'data')
    const profileRoot = join(sandbox, 'facebook-profiles')
    const uid = '100017'
    const profileDirectory = join(profileRoot, uid)
    mkdirSync(profileDirectory, { recursive: true })

    const result = resolveFacebookProfileDirectory(
      dataDirectory,
      { id: 17, uid },
      browserSettings({ profileStorageMode: 'managed', externalProfileRoot: profileRoot })
    )

    expect(result).toEqual({ mode: 'external', profileDirectory })
    expect(existsSync(appManagedFacebookProfileDirectory(dataDirectory, 17))).toBe(false)
  })

  it('creates Root\\UID automatically when the account profile does not exist yet', () => {
    const sandbox = tempRoot()
    const dataDirectory = join(sandbox, 'data')
    const profileRoot = join(sandbox, 'facebook-profiles')
    const uid = '100021'
    const profileDirectory = join(profileRoot, uid)

    const result = resolveFacebookProfileDirectory(
      dataDirectory,
      { id: 21, uid },
      browserSettings({ externalProfileRoot: profileRoot })
    )

    expect(result).toEqual({ mode: 'external', profileDirectory })
    expect(existsSync(profileDirectory)).toBe(true)
    expect(existsSync(appManagedFacebookProfileDirectory(dataDirectory, 21))).toBe(false)
  })

  it('requires the operator to choose one Facebook Profile Root', () => {
    const sandbox = tempRoot()

    let caught: unknown
    try {
      resolveFacebookProfileDirectory(
        join(sandbox, 'data'),
        { id: 9, uid: '100009' },
        browserSettings({ profileStorageMode: 'managed', externalProfileRoot: null })
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(FacebookProfileResolutionError)
    expect((caught as FacebookProfileResolutionError).code).toBe('external_root_not_configured')
    expect(existsSync(appManagedFacebookProfileDirectory(join(sandbox, 'data'), 9))).toBe(false)
  })

  it('rejects UID path traversal', () => {
    const sandbox = tempRoot()
    const profileRoot = join(sandbox, 'facebook-profiles')
    mkdirSync(profileRoot, { recursive: true })

    expect(() => resolveFacebookProfileDirectory(
      join(sandbox, 'data'),
      { id: 3, uid: '..\\outside' },
      browserSettings({ externalProfileRoot: profileRoot })
    )).toThrowError(FacebookProfileResolutionError)
  })
})
