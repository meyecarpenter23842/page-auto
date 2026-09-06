import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync
} from 'node:fs'
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
const DATABASE_SIDECAR_FILENAMES = [DATABASE_FILENAME, `${DATABASE_FILENAME}-wal`, `${DATABASE_FILENAME}-shm`]

function normalizePathForComparison(path: string): string {
  const normalized = resolve(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function pathsEqual(left: string, right: string): boolean {
  return normalizePathForComparison(left) === normalizePathForComparison(right)
}

function migrationSuffix(now: Date, processId: number): string {
  return `${now.toISOString().replace(/[:.]/g, '-')}-${processId}`
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

function backupDatabaseFiles(dataDirectory: string, backupDirectory: string): void {
  mkdirSync(backupDirectory, { recursive: true })
  for (const filename of DATABASE_SIDECAR_FILENAMES) {
    const sourceFile = join(dataDirectory, filename)
    if (existsSync(sourceFile)) copyFileSync(sourceFile, join(backupDirectory, filename))
  }
}

export function prepareDataDirectory(options: PrepareDataDirectoryOptions): PreparedDataDirectory {
  const dataDirectory = resolveDataDirectory(options)
  const override = options.override?.trim()
  if (override || databaseExists(dataDirectory)) {
    ensureDataDirectoryLayout(dataDirectory)
    return { dataDirectory, migration: null }
  }

  const sourceDirectory = resolveLegacyDataDirectories(options, dataDirectory).find(databaseExists)
  if (!sourceDirectory) {
    ensureDataDirectoryLayout(dataDirectory)
    return { dataDirectory, migration: null }
  }

  const now = options.now?.() ?? new Date()
  const processId = options.processId ?? process.pid
  const suffix = migrationSuffix(now, processId)
  const parentDirectory = dirname(dataDirectory)
  const stagingDirectory = join(parentDirectory, `.data-adoption-${suffix}`)
  const databaseBackupDirectory = join(stagingDirectory, 'backups', `pre-stable-data-root-${suffix}`)
  const displacedTargetDirectory = existsSync(dataDirectory)
    ? join(parentDirectory, `data-before-adoption-${suffix}`)
    : undefined

  mkdirSync(parentDirectory, { recursive: true })
  rmSync(stagingDirectory, { recursive: true, force: true })

  let targetDisplaced = false
  try {
    cpSync(sourceDirectory, stagingDirectory, { recursive: true, preserveTimestamps: true })
    ensureDataDirectoryLayout(stagingDirectory)
    backupDatabaseFiles(stagingDirectory, databaseBackupDirectory)

    if (displacedTargetDirectory) {
      renameSync(dataDirectory, displacedTargetDirectory)
      targetDisplaced = true
    }

    renameSync(stagingDirectory, dataDirectory)
  } catch (error) {
    rmSync(stagingDirectory, { recursive: true, force: true })
    if (targetDisplaced && displacedTargetDirectory && !existsSync(dataDirectory)) {
      renameSync(displacedTargetDirectory, dataDirectory)
    }
    throw error
  }

  return {
    dataDirectory,
    migration: {
      sourceDirectory,
      targetDirectory: dataDirectory,
      databaseBackupDirectory: join(dataDirectory, 'backups', `pre-stable-data-root-${suffix}`),
      ...(displacedTargetDirectory ? { displacedTargetDirectory } : {})
    }
  }
}
