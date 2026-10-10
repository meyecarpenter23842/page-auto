import { existsSync, mkdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type { ZaloAccountRecord, ZaloBrowserSettings } from '../../shared/zalo'

export interface ZaloProfileResolution {
  profileRoot: string
  profileDirectory: string
  source: 'managed' | 'external'
}

export class ZaloProfileResolutionError extends Error {
  constructor(public readonly code: 'invalid_root' | 'profile_error', message: string) {
    super(message)
    this.name = 'ZaloProfileResolutionError'
  }
}

export function appManagedZaloProfileRoot(dataDirectory: string): string {
  return join(dataDirectory, 'zalo-browser-profiles')
}

export function resolveZaloProfileDirectory(
  dataDirectory: string,
  account: Pick<ZaloAccountRecord, 'id'>,
  settings: ZaloBrowserSettings
): ZaloProfileResolution {
  const configuredRoot = settings.profileRoot?.trim() || null
  if (configuredRoot) {
    if (!isAbsolute(configuredRoot)) {
      throw new ZaloProfileResolutionError('invalid_root', 'Zalo Profile Root phải là đường dẫn tuyệt đối.')
    }
    const root = resolve(configuredRoot)
    if (!existsSync(root)) {
      throw new ZaloProfileResolutionError('invalid_root', 'Zalo Profile Root không tồn tại; không fallback sang profile Facebook/Email.')
    }
    return { profileRoot: root, profileDirectory: join(root, String(account.id)), source: 'external' }
  }

  const root = appManagedZaloProfileRoot(dataDirectory)
  try {
    mkdirSync(root, { recursive: true })
  } catch (error) {
    throw new ZaloProfileResolutionError('profile_error', error instanceof Error ? error.message : String(error))
  }
  return { profileRoot: root, profileDirectory: join(root, String(account.id)), source: 'managed' }
}
