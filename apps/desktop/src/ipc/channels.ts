import type {
  AccountColumnLayout,
  AccountDraft,
  AccountImportRequest,
  AccountImportResult,
  AccountListFilters,
  AccountRecord,
  BrowserProfileResult,
  ImportPreset,
  SaveImportPresetInput
} from '../shared/accounts'
import type {
  CreatePageTabInput,
  ImageFolderInspection,
  PageTabConfig,
  PageTabIdPayload,
  PageTabSummary,
  PickTextFileResult,
  UpdatePageTabPayload
} from '../shared/pageTabs'
import type { CreateRunPayload, RunDetails, RunIdPayload } from '../shared/runs'

export const IPC_CHANNELS = {
  appInfo: 'app:get-info',
  accountsList: 'accounts:list',
  accountsCreate: 'accounts:create',
  accountsUpdate: 'accounts:update',
  accountsDelete: 'accounts:delete',
  accountsImport: 'accounts:import',
  accountPresetsList: 'accounts:presets:list',
  accountPresetsSave: 'accounts:presets:save',
  accountPresetsDelete: 'accounts:presets:delete',
  accountColumnLayoutGet: 'accounts:columns:get',
  accountColumnLayoutSave: 'accounts:columns:save',
  accountOpenProfile: 'accounts:open-profile',
  pageTabsList: 'page-tabs:list',
  pageTabsGet: 'page-tabs:get',
  pageTabsCreate: 'page-tabs:create',
  pageTabsUpdate: 'page-tabs:update',
  pageTabsDelete: 'page-tabs:delete',
  pageTabsDuplicate: 'page-tabs:duplicate',
  pageTabsPickImageFolder: 'page-tabs:pick-image-folder',
  pageTabsInspectImageFolder: 'page-tabs:inspect-image-folder',
  pageTabsPickTextFile: 'page-tabs:pick-text-file',
  runsLatestForPageTab: 'runs:latest-for-page-tab',
  runsCreate: 'runs:create',
  runsPause: 'runs:pause',
  runsResume: 'runs:resume'
} as const

export interface AppInfo {
  name: string
  version: string
}

export interface AccountUpdatePayload {
  id: number
  patch: Partial<AccountDraft>
}

export interface AccountDeletePayload {
  ids: number[]
}

export interface AccountColumnLayoutPayload {
  layout: AccountColumnLayout
}

export interface AccountOpenProfilePayload {
  accountId: number
}

export interface PageAutoIpcContract {
  listAccounts: (filters?: AccountListFilters) => Promise<AccountRecord[]>
  createAccount: (input: AccountDraft) => Promise<AccountRecord>
  updateAccount: (payload: AccountUpdatePayload) => Promise<AccountRecord>
  deleteAccounts: (payload: AccountDeletePayload) => Promise<number>
  importAccounts: (request: AccountImportRequest) => Promise<AccountImportResult>
  listImportPresets: () => Promise<ImportPreset[]>
  saveImportPreset: (input: SaveImportPresetInput) => Promise<ImportPreset>
  deleteImportPreset: (id: number) => Promise<boolean>
  getAccountColumnLayout: () => Promise<AccountColumnLayout | null>
  saveAccountColumnLayout: (payload: AccountColumnLayoutPayload) => Promise<void>
  openAccountProfile: (payload: AccountOpenProfilePayload) => Promise<BrowserProfileResult>
  listPageTabs: () => Promise<PageTabSummary[]>
  getPageTab: (payload: PageTabIdPayload) => Promise<PageTabConfig | null>
  createPageTab: (input: CreatePageTabInput) => Promise<PageTabConfig>
  updatePageTab: (payload: UpdatePageTabPayload) => Promise<PageTabConfig>
  deletePageTab: (payload: PageTabIdPayload) => Promise<boolean>
  duplicatePageTab: (payload: PageTabIdPayload) => Promise<PageTabConfig>
  pickPageTabImageFolder: () => Promise<string | null>
  inspectPageTabImageFolder: (folderPath: string) => Promise<ImageFolderInspection>
  pickPageTabTextFile: () => Promise<PickTextFileResult | null>
  getLatestRunForPageTab: (payload: CreateRunPayload) => Promise<RunDetails | null>
  createRun: (payload: CreateRunPayload) => Promise<RunDetails>
  pauseRun: (payload: RunIdPayload) => Promise<RunDetails>
  resumeRun: (payload: RunIdPayload) => Promise<RunDetails>
}
