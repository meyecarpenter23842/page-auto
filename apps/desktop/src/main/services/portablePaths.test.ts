import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureDataDirectoryLayout, resolveDataDirectory } from './portablePaths'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('portable paths', () => {
  it('puts packaged runtime data beside PageAuto.exe and dev data under userData', () => {
    const packaged = resolveDataDirectory({
      isPackaged: true,
      execPath: join('portable-root', 'PageAuto.exe'),
      userDataPath: join('dev', 'user-data')
    })
    expect(packaged).toBe(join('portable-root', 'data'))

    const development = resolveDataDirectory({
      isPackaged: false,
      execPath: join('portable-root', 'PageAuto.exe'),
      userDataPath: join('dev', 'user-data')
    })
    expect(development).toBe(join('dev', 'user-data', 'data'))
  })

  it('honors PAGE_AUTO_DATA_DIR override and creates the portable data layout', () => {
    const root = mkdtempSync(join(tmpdir(), 'page-auto-portable-'))
    tempDirectories.push(root)
    const dataDirectory = resolveDataDirectory({
      override: join(root, 'custom-data'),
      isPackaged: true,
      execPath: join(root, 'PageAuto.exe'),
      userDataPath: join(root, 'ignored')
    })
    ensureDataDirectoryLayout(dataDirectory)

    expect(dirname(dataDirectory)).toBe(root)
    for (const child of ['', 'browser-profiles', 'logs', 'screenshots', 'backups', 'checkpoint-assets', join('checkpoint-assets', '282')]) {
      expect(existsSync(child ? join(dataDirectory, child) : dataDirectory)).toBe(true)
    }
  })
})
