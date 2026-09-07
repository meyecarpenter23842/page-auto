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
  it('uses data beside PageAuto.exe when packaged and keeps development on Electron userData', () => {
    const root = createTempRoot()
    const localAppDataPath = join(root, 'LocalAppData')
    const userDataPath = join(root, 'Roaming', '@page-auto', 'desktop')

    const packaged = resolveDataDirectory({
      isPackaged: true,
      execPath: join(root, 'installed', 'PageAuto.exe'),
      userDataPath,
      localAppDataPath
    })
    expect(packaged).toBe(join(root, 'installed', 'data'))

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

  it('migrates packaged userData into the portable data directory and preserves the source', () => {
    const root = createTempRoot()
    const installRoot = join(root, 'portable')
    const userDataPath = join(root, 'Roaming', '@page-auto', 'desktop')
    const legacyData = join(userDataPath, 'data')
    const portableData = join(installRoot, 'data')

    writeFixture(join(legacyData, 'page-auto.sqlite'), 'legacy-db')
    writeFixture(join(legacyData, 'page-auto.sqlite-wal'), 'legacy-wal')
    writeFixture(join(legacyData, 'browser-profiles', '123', 'state.txt'), 'profile-state')

    const prepared = prepareDataDirectory({
      isPackaged: true,
      execPath: join(installRoot, 'PageAuto.exe'),
      userDataPath,
      localAppDataPath: join(root, 'LocalAppData'),
      now: () => new Date('2026-09-07T15:30:00.000Z'),
      processId: 77
    })

    expect(prepared.dataDirectory).toBe(portableData)
    expect(prepared.migration?.sourceDirectory).toBe(legacyData)
    expect(prepared.migration?.targetDirectory).toBe(portableData)
    expect(prepared.migration?.displacedTargetDirectory).toBeUndefined()
    expect(readFileSync(join(portableData, 'page-auto.sqlite'), 'utf8')).toBe('legacy-db')
    expect(readFileSync(join(portableData, 'page-auto.sqlite-wal'), 'utf8')).toBe('legacy-wal')
    expect(readFileSync(join(portableData, 'browser-profiles', '123', 'state.txt'), 'utf8')).toBe('profile-state')
    expect(readFileSync(join(legacyData, 'page-auto.sqlite'), 'utf8')).toBe('legacy-db')
    expect(readFileSync(join(legacyData, 'browser-profiles', '123', 'state.txt'), 'utf8')).toBe('profile-state')
    expect(readFileSync(join(prepared.migration!.databaseBackupDirectory, 'page-auto.sqlite'), 'utf8')).toBe('legacy-db')
    expect(readFileSync(join(prepared.migration!.databaseBackupDirectory, 'page-auto.sqlite-wal'), 'utf8')).toBe('legacy-wal')
  })

  it('migrates the old LocalAppData database when it is the only legacy source', () => {
    const root = createTempRoot()
    const installRoot = join(root, 'installed')
    const localAppDataPath = join(root, 'LocalAppData')
    const legacyData = join(localAppDataPath, 'PageAuto', 'data')
    const portableData = join(installRoot, 'data')

    writeFixture(join(legacyData, 'page-auto.sqlite'), 'localappdata-db')
    writeFixture(join(legacyData, 'screenshots', 'proof.txt'), 'proof')

    const prepared = prepareDataDirectory({
      isPackaged: true,
      execPath: join(installRoot, 'PageAuto.exe'),
      userDataPath: join(root, 'Roaming', '@page-auto', 'desktop'),
      localAppDataPath
    })

    expect(prepared.dataDirectory).toBe(portableData)
    expect(prepared.migration?.sourceDirectory).toBe(legacyData)
    expect(readFileSync(join(portableData, 'page-auto.sqlite'), 'utf8')).toBe('localappdata-db')
    expect(readFileSync(join(portableData, 'screenshots', 'proof.txt'), 'utf8')).toBe('proof')
    expect(readFileSync(join(legacyData, 'page-auto.sqlite'), 'utf8')).toBe('localappdata-db')
  })

  it('uses an existing portable database and never overwrites it from legacy data', () => {
    const root = createTempRoot()
    const installRoot = join(root, 'portable')
    const portableData = join(installRoot, 'data')
    const userDataPath = join(root, 'Roaming', '@page-auto', 'desktop')
    const legacyData = join(userDataPath, 'data')

    writeFixture(join(portableData, 'page-auto.sqlite'), 'portable-db')
    writeFixture(join(legacyData, 'page-auto.sqlite'), 'legacy-db')

    const prepared = prepareDataDirectory({
      isPackaged: true,
      execPath: join(installRoot, 'PageAuto.exe'),
      userDataPath,
      localAppDataPath: join(root, 'LocalAppData')
    })

    expect(prepared).toEqual({ dataDirectory: portableData, migration: null })
    expect(readFileSync(join(portableData, 'page-auto.sqlite'), 'utf8')).toBe('portable-db')
    expect(readFileSync(join(legacyData, 'page-auto.sqlite'), 'utf8')).toBe('legacy-db')
  })

  it('preserves a pre-existing target layout without a database before migration', () => {
    const root = createTempRoot()
    const installRoot = join(root, 'portable')
    const portableData = join(installRoot, 'data')
    const userDataPath = join(root, 'Roaming', '@page-auto', 'desktop')
    const legacyData = join(userDataPath, 'data')

    writeFixture(join(portableData, 'keep.txt'), 'keep-me')
    writeFixture(join(legacyData, 'page-auto.sqlite'), 'legacy-db')

    const prepared = prepareDataDirectory({
      isPackaged: true,
      execPath: join(installRoot, 'PageAuto.exe'),
      userDataPath,
      localAppDataPath: join(root, 'LocalAppData')
    })

    expect(readFileSync(join(portableData, 'page-auto.sqlite'), 'utf8')).toBe('legacy-db')
    expect(prepared.migration?.displacedTargetDirectory).toBeTruthy()
    expect(readFileSync(join(prepared.migration!.displacedTargetDirectory!, 'keep.txt'), 'utf8')).toBe('keep-me')
  })

  it('refuses to guess when multiple legacy databases exist and portable data is missing', () => {
    const root = createTempRoot()
    const installRoot = join(root, 'portable')
    const userDataPath = join(root, 'Roaming', '@page-auto', 'desktop')
    const localAppDataPath = join(root, 'LocalAppData')

    writeFixture(join(userDataPath, 'data', 'page-auto.sqlite'), 'roaming-db')
    writeFixture(join(localAppDataPath, 'PageAuto', 'data', 'page-auto.sqlite'), 'local-db')

    expect(() => prepareDataDirectory({
      isPackaged: true,
      execPath: join(installRoot, 'PageAuto.exe'),
      userDataPath,
      localAppDataPath
    })).toThrow(/Multiple legacy PageAuto databases found/)
    expect(existsSync(join(installRoot, 'data', 'page-auto.sqlite'))).toBe(false)
  })

  it('keeps development data in Electron userData and never migrates it to the executable folder', () => {
    const root = createTempRoot()
    const userDataPath = join(root, 'Roaming', '@page-auto', 'desktop')
    const developmentData = join(userDataPath, 'data')
    const executableData = join(root, 'data')

    writeFixture(join(developmentData, 'page-auto.sqlite'), 'dev-db')

    const prepared = prepareDataDirectory({
      isPackaged: false,
      execPath: join(root, 'PageAuto.exe'),
      userDataPath,
      localAppDataPath: join(root, 'LocalAppData')
    })

    expect(prepared).toEqual({ dataDirectory: developmentData, migration: null })
    expect(readFileSync(join(developmentData, 'page-auto.sqlite'), 'utf8')).toBe('dev-db')
    expect(existsSync(executableData)).toBe(false)
  })

  it('creates an empty portable layout beside the executable when no legacy database exists', () => {
    const root = createTempRoot()
    const portableData = join(root, 'installed', 'data')
    const prepared = prepareDataDirectory({
      isPackaged: true,
      execPath: join(root, 'installed', 'PageAuto.exe'),
      userDataPath: join(root, 'Roaming', '@page-auto', 'desktop'),
      localAppDataPath: join(root, 'LocalAppData')
    })

    expect(prepared).toEqual({ dataDirectory: portableData, migration: null })
    ensureDataDirectoryLayout(prepared.dataDirectory)
    expect(existsSync(join(prepared.dataDirectory, 'checkpoint-assets', '282'))).toBe(true)
  })
})
