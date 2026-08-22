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
  accountOpenProfile: 'accounts:open-profile'
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
}
