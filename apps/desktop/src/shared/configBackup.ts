import type { AccountColumnLayout, AccountImportMapping } from './accounts'
import type { ContentLibraryItemDraft } from './contentLibrary'
import type {
  ContentMode,
  ImageMode,
  MissingImagePolicy,
  PageTabImageConfig,
  PageTabPostInput,
  PageTabRotationConfig,
  PageTabScheduleInput,
  PostSelectionMode
} from './pageTabs'
import type { ScenarioActionCategory } from './scenarios'

export const CONFIG_BACKUP_FORMAT = 'page-auto-config'
export const CONFIG_BACKUP_LEGACY_VERSION = 1
export const CONFIG_BACKUP_VERSION = 2

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

/** v1 compatibility only. New v2 exports use postBindings instead. */
export interface ConfigBackupPostLibrary {
  mode: PostSelectionMode
  posts: PageTabPostInput[]
}

export interface ConfigBackupPostOverrides {
  name: string | null
  variants: string[] | null
  imageFolderPath: string | null
  imageMode: ImageMode | null
  imagesPerPost: number | null
  missingPolicy: MissingImagePolicy | null
}

export interface ConfigBackupPostBinding {
  postKey: string
  enabled: boolean
  sortOrder: number
  overrides: ConfigBackupPostOverrides
}

export interface ConfigBackupCanonicalPost {
  key: string
  name: string
  variants: string[]
  image: PageTabImageConfig
}

export interface ConfigBackupPostCollectionBinding {
  postKey: string
  enabled: boolean
  sortOrder: number
}

export interface ConfigBackupPostCollection {
  key: string
  name: string
  bindings: ConfigBackupPostCollectionBinding[]
}

export interface ConfigBackupPageTab {
  key: string
  name: string
  pageUid: string
  rotation: PageTabRotationConfig
  accounts: ConfigBackupPageTabAccount[]
  schedules: PageTabScheduleInput[]
  groupUids: string[]
  contentMode: ContentMode
  contents: string[]
  image: PageTabImageConfig
  postMode: PostSelectionMode
  postBindings: ConfigBackupPostBinding[]
  /** v1 compatibility only; parser upgrades this to postBindings. */
  postLibrary?: ConfigBackupPostLibrary
}

export interface ConfigBackupScenarioAction {
  key: string
  actionType: string
  label: string
  category: ScenarioActionCategory
  enabled: boolean
  configJson: string
  postBindings: ConfigBackupPostBinding[]
}

export interface ConfigBackupScenario {
  key: string
  name: string
  randomActionOrder: boolean
  runtimeLimitMinutes: number | null
  actions: ConfigBackupScenarioAction[]
}

/** v1 compatibility only. New v2 exports use postCollections. */
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
  posts: ConfigBackupCanonicalPost[]
  postCollections: ConfigBackupPostCollection[]
  scenarios: ConfigBackupScenario[]
  importPresets: ConfigBackupImportPreset[]
  accountColumnLayout: AccountColumnLayout | null
}

export interface ConfigBackupSummary {
  accounts: number
  pageTabs: number
  contentLibraries?: number
  canonicalPosts?: number
  scenarios?: number
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
  canonicalPostsRestored?: number
  scenariosRestored?: number
  importPresetsRestored: number
  columnLayoutRestored: boolean
  message: string
}
