import type { FacebookProfileErrorCode } from './facebookProfile'

export const ACCOUNT_STATUSES = ['unknown', 'valid', 'needs_login', 'disabled'] as const
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number]

export interface AccountRecord {
  id: number
  uid: string
  username: string | null
  password: string | null
  name: string | null
  status: AccountStatus
  category: string | null
  friendCount: number | null
  cookie: string | null
  cookieStatus: string | null
  lastCookieCheck: number | null
  proxy: string | null
  proxyType: string | null
  proxyHost: string | null
  proxyPort: number | null
  proxyUsername: string | null
  proxyPassword: string | null
  twoFactorSecret: string | null
  email: string | null
  emailPassword: string | null
  backupEmail: string | null
  phone: string | null
  userAgent: string | null
  createdDate: string | null
  note: string | null
  lastUsedAt: number | null
  createdAt: number
  updatedAt: number
}

export type AccountWritableField = Exclude<keyof AccountRecord, 'id' | 'createdAt' | 'updatedAt'>
export type AccountDraft = Pick<AccountRecord, 'uid'> & Partial<Omit<AccountRecord, 'id' | 'uid' | 'createdAt' | 'updatedAt'>>

export interface AccountListFilters {
  search?: string
  status?: AccountStatus | 'all'
  category?: string
}

export const ACCOUNT_IMPORT_FIELDS = [
  'uid',
  'username',
  'password',
  'name',
  'cookie',
  'twoFactorSecret',
  'email',
  'emailPassword',
  'backupEmail',
  'phone',
  'proxy',
  'proxyType',
  'proxyHost',
  'proxyPort',
  'proxyUsername',
  'proxyPassword',
  'userAgent',
  'category',
  'note',
  'friendCount',
  'createdDate'
] as const

export type AccountImportField = (typeof ACCOUNT_IMPORT_FIELDS)[number]
export type AccountImportMapping = Array<AccountImportField | 'ignore'>
export type DuplicatePolicy = 'skip' | 'update'
export type AccountImportOperation = 'insert' | 'update'

export interface AccountImportRequest {
  rawText: string
  delimiter: string
  mapping: AccountImportMapping
  /** Existing group selected in the Import UI. For new accounts this overrides mapped Category/Folder. */
  targetGroupName?: string
  /** @deprecated Kept for backward-compatible callers/tests. Prefer operation. */
  duplicatePolicy?: DuplicatePolicy
  operation?: AccountImportOperation
}

export interface AccountImportIssue {
  line: number
  message: string
}

export interface AccountImportResult {
  imported: number
  updated: number
  skipped: number
  errors: AccountImportIssue[]
}

export interface ImportPreset {
  id: number
  name: string
  delimiter: string
  mapping: AccountImportMapping
  createdAt: number
  updatedAt: number
}

export interface SaveImportPresetInput {
  name: string
  delimiter: string
  mapping: AccountImportMapping
}

export interface AccountColumnLayout {
  order: string[]
  hidden: string[]
  widths: Record<string, number>
}

export interface BrowserProfileResult {
  status: 'started' | 'already_open' | 'error'
  code?: FacebookProfileErrorCode
  profileDirectory?: string
  sessionStatus?: AccountStatus
  message?: string
}

export const BUILTIN_IMPORT_PRESETS: Array<SaveImportPresetInput & { key: string }> = [
  {
    key: 'basic',
    name: 'Basic — UID | Cookie',
    delimiter: '|',
    mapping: ['uid', 'cookie']
  },
  {
    key: 'basic-note',
    name: 'Basic — UID | Cookie | Note',
    delimiter: '|',
    mapping: ['uid', 'cookie', 'note']
  },
  {
    key: 'full',
    name: 'Full account',
    delimiter: '|',
    mapping: ['uid', 'password', 'twoFactorSecret', 'cookie', 'email', 'emailPassword', 'proxy', 'userAgent', 'note']
  }
]
