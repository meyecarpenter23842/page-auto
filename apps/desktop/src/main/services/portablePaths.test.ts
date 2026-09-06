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

const fixedNow = (): Date => new Date('2026-09-06T03:00:00.000Z')

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('application data directory', () => {
  it('uses the stable LocalAppData root for packaged and development runtimes', () => {
    const root = createTempRoot()
    const localAppDataPath = join(root, 'LocalAppData')
    const userDataPath = join(root, 'Roaming', 'PageAuto')

    for (const isPackaged of [true, false]) {
      const dataDirectory = resolveDataDirectory({
        isPackaged,
        execPath: join(root, 'portable', 'PageAuto.exe'),
        userDataPath,
        localAppDataPath
      })
      expect(dataDirectory).toBe(join(localAppDataPath, 'PageAuto', 'data'))
    }
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

  it('adopts packaged portable data into the stable root without modifying the source', () => {
    const root = createTempRoot()
    const portableRoot = join(root, 'portable')
    const legacyData = join(portableRoot, 'data')
    writeFixture(join(legacyData, 'page-auto.sqlite'), 'legacy-db')
    writeFixture(join(legacyData, 'page-auto.sqlite-wal'), 'legacy-wal')
    writeFixture(join(legacyData, 'browser-profiles', '123', 'state.txt'), 'profile-state')

    const prepared = prepareDataDirectory({
      isPackaged: true,
      execPath: join(portableRoot, 'PageAuto.exe'),
      userDataPath: join(root, 'Roaming', 'PageAuto'),
      localAppDataPath: join(root, 'LocalAppData'),
      now: fixedNow,
      processId: 77
    })

    expect(prepared.migration?.sourceDirectory).toBe(legacyData)
    expect(readFileSync(join(prepared.dataDirectory, 'page-auto.sqlite'), 'utf8')).toBe('legacy-db')
    expect(readFileSync(join(prepared.dataDirectory, 'browser-profiles', '123', 'state.txt'), 'utf8')).toBe('profile-state')
    expect(readFileSync(join(legacyData, 'page-auto.sqlite'), 'utf8')).toBe('legacy-db')
    expect(readFileSync(join(prepared.migration!.databaseBackupDirectory, 'page-auto.sqlite'), 'utf8')).toBe('legacy-db')
    expect(readFileSync(join(prepared.migration!.databaseBackupDirectory, 'page-auto.sqlite-wal'), 'utf8')).toBe('legacy-wal')
  })

  it('adopts the old development userData directory when no packaged portable source exists', () => {
    const root = createTempRoot()
    const legacyData = join(root, 'Roaming', 'PageAuto', 'data')
    writeFixture(join(legacyData, 'page-auto.sqlite'), 'dev-db')

    const prepared = prepareDataDirectory({
      isPackaged: false,
      execPath: join(root, 'PageAuto.exe'),
      userDataPath: join(root, 'Roaming', 'PageAuto'),
      localAppDataPath: join(root, 'LocalAppData'),
      now: fixedNow,
      processId: 88
    })

    expect(prepared.migration?.sourceDirectory).toBe(legacyData)
    expect(readFileSync(join(prepared.dataDirectory, 'page-auto.sqlite'), 'utf8')).toBe('dev-db')
  })

  it('does not adopt twice or overwrite an existing stable database', () => {
    const root = createTempRoot()
    const portableRoot = join(root, 'portable')
    const legacyDatabase = join(portableRoot, 'data', 'page-auto.sqlite')
    const options = {
      isPackaged: true,
      execPath: join(portableRoot, 'PageAuto.exe'),
      userDataPath: join(root, 'Roaming', 'PageAuto'),
      localAppDataPath: join(root, 'LocalAppData'),
      now: fixedNow,
      processId: 99
    } as const
    writeFixture(legacyDatabase, 'legacy-v1')

    const first = prepareDataDirectory(options)
    expect(first.migration).not.toBeNull()
    writeFileSync(legacyDatabase, 'legacy-v2')

    const second = prepareDataDirectory(options)
    expect(second.migration).toBeNull()
    expect(readFileSync(join(second.dataDirectory, 'page-auto.sqlite'), 'utf8')).toBe('legacy-v1')
  })

  it('preserves a pre-existing target without a database before adopting legacy data', () => {
    const root = createTempRoot()
    const portableRoot = join(root, 'portable')
    const targetData = join(root, 'LocalAppData', 'PageAuto', 'data')
    writeFixture(join(portableRoot, 'data', 'page-auto.sqlite'), 'legacy-db')
    writeFixture(join(targetData, 'keep.txt'), 'keep-me')

    const prepared = prepareDataDirectory({
      isPackaged: true,
      execPath: join(portableRoot, 'PageAuto.exe'),
      userDataPath: join(root, 'Roaming', 'PageAuto'),
      localAppDataPath: join(root, 'LocalAppData'),
      now: fixedNow,
      processId: 111
    })

    expect(prepared.migration?.displacedTargetDirectory).toBeDefined()
    expect(readFileSync(join(prepared.migration!.displacedTargetDirectory!, 'keep.txt'), 'utf8')).toBe('keep-me')
    expect(readFileSync(join(prepared.dataDirectory, 'page-auto.sqlite'), 'utf8')).toBe('legacy-db')
  })

  it('creates an empty stable layout when no legacy database exists', () => {
    const root = createTempRoot()
    const prepared = prepareDataDirectory({
      isPackaged: true,
      execPath: join(root, 'portable', 'PageAuto.exe'),
      userDataPath: join(root, 'Roaming', 'PageAuto'),
      localAppDataPath: join(root, 'LocalAppData')
    })

    expect(prepared.migration).toBeNull()
    ensureDataDirectoryLayout(prepared.dataDirectory)
    expect(existsSync(join(prepared.dataDirectory, 'checkpoint-assets', '282'))).toBe(true)
  })
})
