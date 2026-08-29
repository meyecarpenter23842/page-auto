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

function modeFor(settings: BrowserSettings): FacebookProfileStorageMode {
  return settings.profileStorageMode ?? 'managed'
}

function directoryState(path: string): 'directory' | 'missing' | 'other' {
  try {
    return statSync(path).isDirectory() ? 'directory' : 'other'
  } catch {
    return 'missing'
  }
}

function safeExternalProfileDirectory(root: string, uid: string): string {
  const normalizedRoot = root.trim()
  const normalizedUid = uid.trim()
  if (!normalizedUid || normalizedUid === '.' || normalizedUid === '..' || /[\\/]/.test(normalizedUid)) {
    throw new FacebookProfileResolutionError('account_uid_invalid', 'UID account không hợp lệ để resolve Facebook Profile Root.')
  }
  if (!normalizedRoot) {
    throw new FacebookProfileResolutionError('external_root_not_configured', 'Chưa cấu hình Facebook Profile Root ngoài app.')
  }
  if (!isAbsolute(normalizedRoot)) {
    throw new FacebookProfileResolutionError('external_root_invalid', 'Facebook Profile Root phải là đường dẫn tuyệt đối.')
  }

  const base = resolve(normalizedRoot)
  const candidate = resolve(base, normalizedUid)
  const rel = relative(base, candidate)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new FacebookProfileResolutionError('account_uid_invalid', 'UID account không hợp lệ để resolve Facebook Profile Root.')
  }
  return candidate
}

export function appManagedFacebookProfileDirectory(dataDirectory: string, accountId: number): string {
  return join(dataDirectory, 'browser-profiles', `account-${accountId}`)
}

export function validateFacebookExternalProfileRoot(settings: BrowserSettings): void {
  if (modeFor(settings) !== 'external') return
  const root = settings.externalProfileRoot?.trim() ?? ''
  if (!root) {
    throw new FacebookProfileResolutionError('external_root_not_configured', 'Chưa chọn Facebook Profile Root ngoài app.')
  }
  if (!isAbsolute(root)) {
    throw new FacebookProfileResolutionError('external_root_invalid', 'Facebook Profile Root phải là đường dẫn tuyệt đối.')
  }
  const state = directoryState(resolve(root))
  if (state === 'missing') {
    throw new FacebookProfileResolutionError('external_root_invalid', 'Facebook Profile Root không tồn tại.')
  }
  if (state !== 'directory') {
    throw new FacebookProfileResolutionError('external_root_invalid', 'Facebook Profile Root không phải thư mục.')
  }
}

export function inspectFacebookProfileDirectory(
  dataDirectory: string,
  account: Pick<AccountRecord, 'id' | 'uid'>,
  settings: BrowserSettings
): FacebookProfileInspection {
  const mode = modeFor(settings)
  if (mode === 'managed') {
    const profileDirectory = appManagedFacebookProfileDirectory(dataDirectory, account.id)
    return { mode, profileDirectory, exists: directoryState(profileDirectory) === 'directory' }
  }

  validateFacebookExternalProfileRoot(settings)
  const profileDirectory = safeExternalProfileDirectory(settings.externalProfileRoot ?? '', account.uid)
  const state = directoryState(profileDirectory)
  if (state === 'other') {
    throw new FacebookProfileResolutionError(
      'external_profile_invalid',
      `Facebook profile cho UID ${account.uid} không phải thư mục hợp lệ.`
    )
  }
  return { mode, profileDirectory, exists: state === 'directory' }
}

export function resolveFacebookProfileDirectory(
  dataDirectory: string,
  account: Pick<AccountRecord, 'id' | 'uid'>,
  settings: BrowserSettings
): FacebookProfileResolution {
  const mode = modeFor(settings)
  if (mode === 'managed') {
    const profileDirectory = appManagedFacebookProfileDirectory(dataDirectory, account.id)
    try {
      mkdirSync(profileDirectory, { recursive: true })
    } catch {
      throw new FacebookProfileResolutionError(
        'managed_profile_create_failed',
        `Không thể tạo Facebook profile do app quản lý cho account #${account.id}.`
      )
    }
    return { mode, profileDirectory }
  }

  const inspected = inspectFacebookProfileDirectory(dataDirectory, account, settings)
  if (!inspected.exists) {
    throw new FacebookProfileResolutionError(
      'external_profile_missing',
      `Không tìm thấy Facebook profile cho UID ${account.uid} trong Profile Root đã chọn. External mode không tự tạo hoặc fallback sang profile của app.`
    )
  }
  return { mode: inspected.mode, profileDirectory: inspected.profileDirectory }
}
