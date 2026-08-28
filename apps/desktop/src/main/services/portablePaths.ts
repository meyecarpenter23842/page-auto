import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface DataDirectoryOptions {
  override?: string | undefined
  isPackaged: boolean
  execPath: string
  userDataPath: string
}

export function resolveDataDirectory(options: DataDirectoryOptions): string {
  const override = options.override?.trim()
  if (override) return override
  return options.isPackaged
    ? join(dirname(options.execPath), 'data')
    : join(options.userDataPath, 'data')
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
