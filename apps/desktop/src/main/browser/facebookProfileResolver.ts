import { mkdirSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { AccountRecord } from '../../shared/accounts'
import type { BrowserSettings } from '../../shared/appSettings'
import type { FacebookProfileErrorCode, FacebookProfileStorageMode } from '../../shared/facebookProfile'

export class FacebookProfileResolutionError extends Error {
  constructor(
    public readonly code: FacebookProfileErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'FacebookProfileResolutionError'
  }
}

export interface FacebookProfileResolution {
  mode: FacebookProfileStorageMode
  profileDirectory: string
}

export interface FacebookProfileInspection extends FacebookProfileResolution {
  exists: boolean
}

function directoryState(path: string): 'directory' | 'missing' | 'other' {
  try {
    return statSync(path).isDirectory() ? 'directory' : 'other'
  } catch {
    return 'missing'
  }
}

function safeProfileDirectory(root: string, uid: string): string {
  const normalizedRoot = root.trim()
  const normalizedUid = uid.trim()
  if (!normalizedUid || normalizedUid === '.' || normalizedUid === '..' || /[\\/]/.test(normalizedUid)) {
    throw new FacebookProfileResolutionError('account_uid_invalid', 'UID account không hợp lệ để tạo Facebook Profile.')
  }
  if (!normalizedRoot) {
    throw new FacebookProfileResolutionError('external_root_not_configured', 'Chưa chọn thư mục lưu Facebook Profile.')
  }
  if (!isAbsolute(normalizedRoot)) {
    throw new FacebookProfileResolutionError('external_root_invalid', 'Thư mục lưu Facebook Profile phải là đường dẫn tuyệt đối.')
  }

  const base = resolve(normalizedRoot)
  const candidate = resolve(base, normalizedUid)
  const rel = relative(base, candidate)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new FacebookProfileResolutionError('account_uid_invalid', 'UID account không hợp lệ để tạo Facebook Profile.')
  }
  return candidate
}

/** @deprecated Legacy app-managed path. Facebook runtime no longer resolves profiles here. */
export function appManagedFacebookProfileDirectory(dataDirectory: string, accountId: number): string {
  return join(dataDirectory, 'browser-profiles', `account-${accountId}`)
}

/**
 * Facebook profiles always live under the operator-selected root as Root\\UID.
 * The old profileStorageMode setting is kept only for stored-settings compatibility and is ignored here.
 */
export function validateFacebookExternalProfileRoot(settings: BrowserSettings): void {
  const root = settings.externalProfileRoot?.trim() ?? ''
  if (!root) {
    throw new FacebookProfileResolutionError('external_root_not_configured', 'Chưa chọn thư mục lưu Facebook Profile.')
  }
  if (!isAbsolute(root)) {
    throw new FacebookProfileResolutionError('external_root_invalid', 'Thư mục lưu Facebook Profile phải là đường dẫn tuyệt đối.')
  }
  const state = directoryState(resolve(root))
  if (state === 'other') {
    throw new FacebookProfileResolutionError('external_root_invalid', 'Đường dẫn lưu Facebook Profile không phải thư mục.')
  }
}

function ensureProfileDirectory(profileDirectory: string, uid: string): void {
  const state = directoryState(profileDirectory)
  if (state === 'other') {
    throw new FacebookProfileResolutionError(
      'external_profile_invalid',
      `Facebook profile cho UID ${uid} không phải thư mục hợp lệ.`
    )
  }
  if (state === 'directory') return
  try {
    mkdirSync(profileDirectory, { recursive: true })
  } catch {
    throw new FacebookProfileResolutionError(
      'profile_create_failed',
      `Không thể tạo Facebook profile Root\\${uid} trong thư mục đã chọn.`
    )
  }
}

export function inspectFacebookProfileDirectory(
  _dataDirectory: string,
  account: Pick<AccountRecord, 'id' | 'uid'>,
  settings: BrowserSettings
): FacebookProfileInspection {
  validateFacebookExternalProfileRoot(settings)
  const profileDirectory = safeProfileDirectory(settings.externalProfileRoot ?? '', account.uid)
  ensureProfileDirectory(profileDirectory, account.uid)
  return { mode: 'external', profileDirectory, exists: true }
}

export function resolveFacebookProfileDirectory(
  dataDirectory: string,
  account: Pick<AccountRecord, 'id' | 'uid'>,
  settings: BrowserSettings
): FacebookProfileResolution {
  const inspected = inspectFacebookProfileDirectory(dataDirectory, account, settings)
  return { mode: 'external', profileDirectory: inspected.profileDirectory }
}
