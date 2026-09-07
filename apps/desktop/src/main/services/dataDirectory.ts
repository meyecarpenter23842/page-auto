import { copyFileSync, cpSync, existsSync, mkdirSync, renameSync } from 'node:fs'
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
const DATABASE_COMPANION_FILENAMES = [
  DATABASE_FILENAME,
  `${DATABASE_FILENAME}-wal`,
  `${DATABASE_FILENAME}-shm`
] as const

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

function uniquePath(basePath: string): string {
  if (!existsSync(basePath)) return basePath
  let suffix = 1
  while (existsSync(`${basePath}-${suffix}`)) suffix += 1
  return `${basePath}-${suffix}`
}

function migrationSuffix(options: PrepareDataDirectoryOptions): string {
  const now = (options.now ?? (() => new Date()))()
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  return `${stamp}-${options.processId ?? process.pid}`
}

function backupDatabaseFiles(sourceDirectory: string, backupDirectory: string): void {
  mkdirSync(backupDirectory, { recursive: true })
  for (const filename of DATABASE_COMPANION_FILENAMES) {
    const source = join(sourceDirectory, filename)
    if (existsSync(source)) copyFileSync(source, join(backupDirectory, filename))
  }
}

export function resolveDataDirectory(options: DataDirectoryOptions): string {
  const override = options.override?.trim()
  if (override) return override
  if (!options.isPackaged) return join(options.userDataPath, 'data')
  return join(dirname(options.execPath), 'data')
}

export function resolveLegacyDataDirectories(options: DataDirectoryOptions, targetDirectory: string): string[] {
  if (!options.isPackaged) return []

  const candidates = [join(options.userDataPath, 'data')]
  const localAppDataPath = options.localAppDataPath?.trim()
  if (localAppDataPath) candidates.push(join(localAppDataPath, 'PageAuto', 'data'))

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

  const legacyDataDirectories = resolveLegacyDataDirectories(options, preferredDataDirectory).filter(databaseExists)
  if (legacyDataDirectories.length > 1) {
    throw new Error(
      `Multiple legacy PageAuto databases found while portable data is missing: ${legacyDataDirectories.join(', ')}`
    )
  }

  const legacyDataDirectory = legacyDataDirectories[0]
  if (!legacyDataDirectory) {
    ensureDataDirectoryLayout(preferredDataDirectory)
    return { dataDirectory: preferredDataDirectory, migration: null }
  }

  const suffix = migrationSuffix(options)
  const installDirectory = dirname(preferredDataDirectory)
  const databaseBackupDirectory = uniquePath(join(installDirectory, `data-migration-backup-${suffix}`))
  const stagingDirectory = uniquePath(join(installDirectory, `.pageauto-data-migration-${suffix}`))
  const displacedTargetDirectory = existsSync(preferredDataDirectory)
    ? uniquePath(join(installDirectory, `data-before-migration-${suffix}`))
    : undefined

  backupDatabaseFiles(legacyDataDirectory, databaseBackupDirectory)

  try {
    cpSync(legacyDataDirectory, stagingDirectory, {
      recursive: true,
      errorOnExist: true,
      force: false
    })
    if (!databaseExists(stagingDirectory)) {
      throw new Error(`Portable data migration staging DB missing: ${join(stagingDirectory, DATABASE_FILENAME)}`)
    }

    if (displacedTargetDirectory) renameSync(preferredDataDirectory, displacedTargetDirectory)
    renameSync(stagingDirectory, preferredDataDirectory)
    ensureDataDirectoryLayout(preferredDataDirectory)
  } catch (error) {
    if (
      displacedTargetDirectory
      && !existsSync(preferredDataDirectory)
      && existsSync(displacedTargetDirectory)
    ) {
      renameSync(displacedTargetDirectory, preferredDataDirectory)
    }
    throw error
  }

  return {
    dataDirectory: preferredDataDirectory,
    migration: {
      sourceDirectory: legacyDataDirectory,
      targetDirectory: preferredDataDirectory,
      databaseBackupDirectory,
      displacedTargetDirectory
    }
  }
}
