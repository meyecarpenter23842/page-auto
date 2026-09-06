import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export interface DataDirectoryOptions {
  override?: string | undefined
  isPackaged: boolean
  execPath: string
  userDataPath: string
  localAppDataPath?: string | undefined
}

export interface PrepareDataDirectoryOptions extends DataDirectoryOptions {
  now?: (() => Date) | undefined
  processId?: number | undefined
}

export interface DataDirectoryMigrationResult {
  sourceDirectory: string
  targetDirectory: string
  databaseBackupDirectory: string
  displacedTargetDirectory?: string | undefined
}

export interface PreparedDataDirectory {
  dataDirectory: string
  migration: DataDirectoryMigrationResult | null
}

const DATABASE_FILENAME = 'page-auto.sqlite'

function normalizePathForComparison(path: string): string {
  const normalized = resolve(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function pathsEqual(left: string, right: string): boolean {
  return normalizePathForComparison(left) === normalizePathForComparison(right)
}

function databaseExists(dataDirectory: string): boolean {
  return existsSync(join(dataDirectory, DATABASE_FILENAME))
}

export function resolveDataDirectory(options: DataDirectoryOptions): string {
  const override = options.override?.trim()
  if (override) return override
  if (!options.isPackaged) return join(options.userDataPath, 'data')

  const localAppDataPath = options.localAppDataPath?.trim()
  if (localAppDataPath) return join(localAppDataPath, 'PageAuto', 'data')

  return join(options.userDataPath, 'data')
}

export function resolveLegacyDataDirectories(options: DataDirectoryOptions, targetDirectory: string): string[] {
  if (!options.isPackaged) return []

  const candidates = [join(dirname(options.execPath), 'data'), join(options.userDataPath, 'data')]
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const normalized = normalizePathForComparison(candidate)
    if (pathsEqual(candidate, targetDirectory) || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

export function ensureDataDirectoryLayout(dataDirectory: string): void {
  const directories = [
    dataDirectory,
    join(dataDirectory, 'browser-profiles'),
    join(dataDirectory, 'logs'),
    join(dataDirectory, 'screenshots'),
    join(dataDirectory, 'backups'),
    join(dataDirectory, 'checkpoint-assets'),
    join(dataDirectory, 'checkpoint-assets', '282')
  ]
  for (const directory of directories) {
    mkdirSync(directory, { recursive: true })
  }
}

export function prepareDataDirectory(options: PrepareDataDirectoryOptions): PreparedDataDirectory {
  const preferredDataDirectory = resolveDataDirectory(options)
  const override = options.override?.trim()

  if (override || !options.isPackaged || databaseExists(preferredDataDirectory)) {
    ensureDataDirectoryLayout(preferredDataDirectory)
    return { dataDirectory: preferredDataDirectory, migration: null }
  }

  const legacyDataDirectory = resolveLegacyDataDirectories(options, preferredDataDirectory).find(databaseExists)
  if (legacyDataDirectory) {
    // Existing DB/profile data already lives outside the installed binaries. Reuse it
    // in place instead of synchronously copying potentially huge browser profiles at startup.
    ensureDataDirectoryLayout(legacyDataDirectory)
    return { dataDirectory: legacyDataDirectory, migration: null }
  }

  ensureDataDirectoryLayout(preferredDataDirectory)
  return { dataDirectory: preferredDataDirectory, migration: null }
}
