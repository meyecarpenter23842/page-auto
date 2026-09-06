import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureDataDirectoryLayout, prepareDataDirectory, resolveDataDirectory } from './dataDirectory'

const tempDirectories: string[] = []

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'page-auto-data-root-'))
  tempDirectories.push(root)
  return root
}

function writeFixture(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('application data directory', () => {
  it('uses stable LocalAppData when packaged and keeps development on Electron userData', () => {
    const root = createTempRoot()
    const localAppDataPath = join(root, 'LocalAppData')
    const userDataPath = join(root, 'Roaming', 'PageAuto')

    const packaged = resolveDataDirectory({
      isPackaged: true,
      execPath: join(root, 'installed', 'PageAuto.exe'),
      userDataPath,
      localAppDataPath
    })
    expect(packaged).toBe(join(localAppDataPath, 'PageAuto', 'data'))

    const development = resolveDataDirectory({
      isPackaged: false,
      execPath: join(root, 'PageAuto.exe'),
      userDataPath,
      localAppDataPath
    })
    expect(development).toBe(join(userDataPath, 'data'))
  })

  it('honors PAGE_AUTO_DATA_DIR override and creates the standard layout', () => {
    const root = createTempRoot()
    const dataDirectory = join(root, 'custom-data')
    const prepared = prepareDataDirectory({
      override: dataDirectory,
      isPackaged: true,
      execPath: join(root, 'PageAuto.exe'),
      userDataPath: join(root, 'user-data'),
      localAppDataPath: join(root, 'LocalAppData')
    })

    expect(prepared).toEqual({ dataDirectory, migration: null })
    for (const child of ['', 'browser-profiles', 'logs', 'screenshots', 'backups', 'checkpoint-assets', join('checkpoint-assets', '282')]) {
      expect(existsSync(child ? join(dataDirectory, child) : dataDirectory)).toBe(true)
    }
  })

  it('reuses packaged portable data in place instead of copying browser profiles at startup', () => {
    const root = createTempRoot()
    const portableRoot = join(root, 'portable')
    const legacyData = join(portableRoot, 'data')
    const stableData = join(root, 'LocalAppData', 'PageAuto', 'data')
    writeFixture(join(legacyData, 'page-auto.sqlite'), 'legacy-db')
    writeFixture(join(legacyData, 'browser-profiles', '123', 'state.txt'), 'profile-state')

    const prepared = prepareDataDirectory({
      isPackaged: true,
      execPath: join(portableRoot, 'PageAuto.exe'),
      userDataPath: join(root, 'Roaming', 'PageAuto'),
      localAppDataPath: join(root, 'LocalAppData')
    })

    expect(prepared).toEqual({ dataDirectory: legacyData, migration: null })
    expect(readFileSync(join(legacyData, 'page-auto.sqlite'), 'utf8')).toBe('legacy-db')
    expect(readFileSync(join(legacyData, 'browser-profiles', '123', 'state.txt'), 'utf8')).toBe('profile-state')
    expect(existsSync(stableData)).toBe(false)
  })

  it('reuses existing packaged userData data in place for installer transition', () => {
    const root = createTempRoot()
    const userDataPath = join(root, 'Roaming', 'PageAuto')
    const legacyData = join(userDataPath, 'data')
    const stableData = join(root, 'LocalAppData', 'PageAuto', 'data')
    writeFixture(join(legacyData, 'page-auto.sqlite'), 'current-db')
    writeFixture(join(legacyData, 'browser-profiles', '456', 'state.txt'), 'current-profile')

    const prepared = prepareDataDirectory({
      isPackaged: true,
      execPath: join(root, 'installed', 'PageAuto.exe'),
      userDataPath,
      localAppDataPath: join(root, 'LocalAppData')
    })

    expect(prepared).toEqual({ dataDirectory: legacyData, migration: null })
    expect(readFileSync(join(legacyData, 'page-auto.sqlite'), 'utf8')).toBe('current-db')
    expect(readFileSync(join(legacyData, 'browser-profiles', '456', 'state.txt'), 'utf8')).toBe('current-profile')
    expect(existsSync(stableData)).toBe(false)
  })

  it('keeps development data in place and never adopts it into LocalAppData', () => {
    const root = createTempRoot()
    const userDataPath = join(root, 'Roaming', 'PageAuto')
    const developmentData = join(userDataPath, 'data')
    const localAppDataPath = join(root, 'LocalAppData')
    writeFixture(join(developmentData, 'page-auto.sqlite'), 'dev-db')
    writeFixture(join(developmentData, 'browser-profiles', '123', 'state.txt'), 'profile-state')

    const prepared = prepareDataDirectory({
      isPackaged: false,
      execPath: join(root, 'PageAuto.exe'),
      userDataPath,
      localAppDataPath
    })

    expect(prepared).toEqual({ dataDirectory: developmentData, migration: null })
    expect(readFileSync(join(developmentData, 'page-auto.sqlite'), 'utf8')).toBe('dev-db')
    expect(readFileSync(join(developmentData, 'browser-profiles', '123', 'state.txt'), 'utf8')).toBe('profile-state')
    expect(existsSync(join(localAppDataPath, 'PageAuto', 'data'))).toBe(false)
  })

  it('prefers an existing stable database over any legacy data', () => {
    const root = createTempRoot()
    const portableRoot = join(root, 'portable')
    const stableData = join(root, 'LocalAppData', 'PageAuto', 'data')
    writeFixture(join(portableRoot, 'data', 'page-auto.sqlite'), 'legacy-db')
    writeFixture(join(stableData, 'page-auto.sqlite'), 'stable-db')

    const prepared = prepareDataDirectory({
      isPackaged: true,
      execPath: join(portableRoot, 'PageAuto.exe'),
      userDataPath: join(root, 'Roaming', 'PageAuto'),
      localAppDataPath: join(root, 'LocalAppData')
    })

    expect(prepared).toEqual({ dataDirectory: stableData, migration: null })
    expect(readFileSync(join(stableData, 'page-auto.sqlite'), 'utf8')).toBe('stable-db')
  })

  it('preserves an empty stable target and reuses legacy data without overwriting either location', () => {
    const root = createTempRoot()
    const portableRoot = join(root, 'portable')
    const legacyData = join(portableRoot, 'data')
    const stableData = join(root, 'LocalAppData', 'PageAuto', 'data')
    writeFixture(join(legacyData, 'page-auto.sqlite'), 'legacy-db')
    writeFixture(join(stableData, 'keep.txt'), 'keep-me')

    const prepared = prepareDataDirectory({
      isPackaged: true,
      execPath: join(portableRoot, 'PageAuto.exe'),
      userDataPath: join(root, 'Roaming', 'PageAuto'),
      localAppDataPath: join(root, 'LocalAppData')
    })

    expect(prepared).toEqual({ dataDirectory: legacyData, migration: null })
    expect(readFileSync(join(stableData, 'keep.txt'), 'utf8')).toBe('keep-me')
    expect(readFileSync(join(legacyData, 'page-auto.sqlite'), 'utf8')).toBe('legacy-db')
  })

  it('creates an empty stable layout when no legacy database exists', () => {
    const root = createTempRoot()
    const stableData = join(root, 'LocalAppData', 'PageAuto', 'data')
    const prepared = prepareDataDirectory({
      isPackaged: true,
      execPath: join(root, 'installed', 'PageAuto.exe'),
      userDataPath: join(root, 'Roaming', 'PageAuto'),
      localAppDataPath: join(root, 'LocalAppData')
    })

    expect(prepared).toEqual({ dataDirectory: stableData, migration: null })
    ensureDataDirectoryLayout(prepared.dataDirectory)
    expect(existsSync(join(prepared.dataDirectory, 'checkpoint-assets', '282'))).toBe(true)
  })
})
