import type { AccountColumnLayout, AccountImportMapping } from './accounts'
import type { ContentLibraryItemDraft } from './contentLibrary'
import type {
  ContentMode,
  PageTabImageConfig,
  PageTabPostInput,
  PageTabRotationConfig,
  PageTabScheduleInput,
  PostSelectionMode
} from './pageTabs'

export const CONFIG_BACKUP_FORMAT = 'page-auto-config'
export const CONFIG_BACKUP_VERSION = 1

export interface ConfigBackupAccountRef {
  uid: string
  name: string | null
  category: string | null
}

export interface ConfigBackupPageTabAccount {
  uid: string
  enabled: boolean
  sortOrder: number
  postsPerTurn: number | null
}

export interface ConfigBackupPostLibrary {
  mode: PostSelectionMode
  posts: PageTabPostInput[]
}

export interface ConfigBackupPageTab {
  name: string
  pageUid: string
  rotation: PageTabRotationConfig
  accounts: ConfigBackupPageTabAccount[]
  schedules: PageTabScheduleInput[]
  groupUids: string[]
  contentMode: ContentMode
  contents: string[]
  image: PageTabImageConfig
  postLibrary?: ConfigBackupPostLibrary
}

export interface ConfigBackupContentLibrary {
  name: string
  items: ContentLibraryItemDraft[]
}

export interface ConfigBackupImportPreset {
  name: string
  delimiter: string
  mapping: AccountImportMapping
}

export interface ConfigBackupPayload {
  format: typeof CONFIG_BACKUP_FORMAT
  version: typeof CONFIG_BACKUP_VERSION
  appVersion: string
  exportedAt: number
  security: {
    containsSecrets: false
    excludes: string[]
  }
  accounts: ConfigBackupAccountRef[]
  pageTabs: ConfigBackupPageTab[]
  /** Optional to keep old v1 backup files restorable. New exports always include it. */
  contentLibraries?: ConfigBackupContentLibrary[]
  importPresets: ConfigBackupImportPreset[]
  accountColumnLayout: AccountColumnLayout | null
}

export interface ConfigBackupSummary {
  accounts: number
  pageTabs: number
  contentLibraries?: number
  importPresets: number
  hasColumnLayout: boolean
}

export interface ConfigBackupExportResult {
  canceled: boolean
  filePath: string | null
  summary: ConfigBackupSummary | null
  message: string
}

export interface ConfigBackupRestoreResult {
  canceled: boolean
  filePath: string | null
  accountsCreated: number
  pageTabsCreated: number
  pageTabsUpdated: number
  contentLibrariesRestored?: number
  importPresetsRestored: number
  columnLayoutRestored: boolean
  message: string
}
