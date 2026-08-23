import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type AccountColumnLayoutPayload,
  type AccountDeletePayload,
  type AccountOpenProfilePayload,
  type AccountUpdatePayload,
  type AppInfo
} from '../ipc/channels'
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
import type { AppSettings, AppSettingsPatch } from '../shared/appSettings'
import type { CaptchaSettingsView, SaveCaptchaSettingsInput } from '../shared/captchaSettings'
import type { ConfigBackupExportResult, ConfigBackupRestoreResult } from '../shared/configBackup'
import type {
  ExecutionLogFilters,
  ExecutionLogRecord,
  RetryRunItemPayload,
  RetryRunItemResult
} from '../shared/executionLogs'
import type {
  CreatePageTabInput,
  ImageFolderInspection,
  PageTabConfig,
  PageTabIdPayload,
  PageTabSummary,
  PickTextFileResult,
  UpdatePageTabPayload
} from '../shared/pageTabs'
import type { ExecuteSinglePostingJobPayload, ExecuteSinglePostingJobResult } from '../shared/posting'
import type { RotationPageTabPayload, RotationRuntimeSnapshot } from '../shared/rotation'
import type { CreateRunPayload, RunDetails, RunIdPayload } from '../shared/runs'

const api = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC_CHANNELS.appInfo) as Promise<AppInfo>,
  listAccounts: (filters?: AccountListFilters): Promise<AccountRecord[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountsList, filters) as Promise<AccountRecord[]>,
  createAccount: (input: AccountDraft): Promise<AccountRecord> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountsCreate, input) as Promise<AccountRecord>,
  updateAccount: (payload: AccountUpdatePayload): Promise<AccountRecord> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountsUpdate, payload) as Promise<AccountRecord>,
  deleteAccounts: (payload: AccountDeletePayload): Promise<number> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountsDelete, payload) as Promise<number>,
  importAccounts: (request: AccountImportRequest): Promise<AccountImportResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountsImport, request) as Promise<AccountImportResult>,
  listImportPresets: (): Promise<ImportPreset[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountPresetsList) as Promise<ImportPreset[]>,
  saveImportPreset: (input: SaveImportPresetInput): Promise<ImportPreset> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountPresetsSave, input) as Promise<ImportPreset>,
  deleteImportPreset: (id: number): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountPresetsDelete, id) as Promise<boolean>,
  getAccountColumnLayout: (): Promise<AccountColumnLayout | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountColumnLayoutGet) as Promise<AccountColumnLayout | null>,
  saveAccountColumnLayout: (payload: AccountColumnLayoutPayload): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountColumnLayoutSave, payload) as Promise<void>,
  openAccountProfile: (payload: AccountOpenProfilePayload): Promise<BrowserProfileResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.accountOpenProfile, payload) as Promise<BrowserProfileResult>,
  listPageTabs: (): Promise<PageTabSummary[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.pageTabsList) as Promise<PageTabSummary[]>,
  getPageTab: (payload: PageTabIdPayload): Promise<PageTabConfig | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.pageTabsGet, payload) as Promise<PageTabConfig | null>,
  createPageTab: (input: CreatePageTabInput): Promise<PageTabConfig> =>
    ipcRenderer.invoke(IPC_CHANNELS.pageTabsCreate, input) as Promise<PageTabConfig>,
  updatePageTab: (payload: UpdatePageTabPayload): Promise<PageTabConfig> =>
    ipcRenderer.invoke(IPC_CHANNELS.pageTabsUpdate, payload) as Promise<PageTabConfig>,
  deletePageTab: (payload: PageTabIdPayload): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.pageTabsDelete, payload) as Promise<boolean>,
  duplicatePageTab: (payload: PageTabIdPayload): Promise<PageTabConfig> =>
    ipcRenderer.invoke(IPC_CHANNELS.pageTabsDuplicate, payload) as Promise<PageTabConfig>,
  pickPageTabImageFolder: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.pageTabsPickImageFolder) as Promise<string | null>,
  inspectPageTabImageFolder: (folderPath: string): Promise<ImageFolderInspection> =>
    ipcRenderer.invoke(IPC_CHANNELS.pageTabsInspectImageFolder, folderPath) as Promise<ImageFolderInspection>,
  pickPageTabTextFile: (): Promise<PickTextFileResult | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.pageTabsPickTextFile) as Promise<PickTextFileResult | null>,
  getLatestRunForPageTab: (payload: CreateRunPayload): Promise<RunDetails | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.runsLatestForPageTab, payload) as Promise<RunDetails | null>,
  createRun: (payload: CreateRunPayload): Promise<RunDetails> =>
    ipcRenderer.invoke(IPC_CHANNELS.runsCreate, payload) as Promise<RunDetails>,
  pauseRun: (payload: RunIdPayload): Promise<RunDetails> =>
    ipcRenderer.invoke(IPC_CHANNELS.runsPause, payload) as Promise<RunDetails>,
  resumeRun: (payload: RunIdPayload): Promise<RunDetails> =>
    ipcRenderer.invoke(IPC_CHANNELS.runsResume, payload) as Promise<RunDetails>,
  executeSinglePostingJob: (payload: ExecuteSinglePostingJobPayload): Promise<ExecuteSinglePostingJobResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.postingExecuteSingle, payload) as Promise<ExecuteSinglePostingJobResult>,
  listPageTabRotations: (): Promise<RotationRuntimeSnapshot[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.rotationList) as Promise<RotationRuntimeSnapshot[]>,
  getPageTabRotationStatus: (payload: RotationPageTabPayload): Promise<RotationRuntimeSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.rotationStatus, payload) as Promise<RotationRuntimeSnapshot>,
  startPageTabRotation: (payload: RotationPageTabPayload): Promise<RotationRuntimeSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.rotationStart, payload) as Promise<RotationRuntimeSnapshot>,
  pausePageTabRotation: (payload: RotationPageTabPayload): Promise<RotationRuntimeSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.rotationPause, payload) as Promise<RotationRuntimeSnapshot>,
  resumePageTabRotation: (payload: RotationPageTabPayload): Promise<RotationRuntimeSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.rotationResume, payload) as Promise<RotationRuntimeSnapshot>,
  listExecutionLogs: (filters?: ExecutionLogFilters): Promise<ExecutionLogRecord[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.executionLogsList, filters) as Promise<ExecutionLogRecord[]>,
  retryExecutionLogItem: (payload: RetryRunItemPayload): Promise<RetryRunItemResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.executionLogsRetryItem, payload) as Promise<RetryRunItemResult>,
  exportConfigBackup: (): Promise<ConfigBackupExportResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.configBackupExport) as Promise<ConfigBackupExportResult>,
  restoreConfigBackup: (): Promise<ConfigBackupRestoreResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.configBackupRestore) as Promise<ConfigBackupRestoreResult>,
  getAppSettings: (): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC_CHANNELS.appSettingsGet) as Promise<AppSettings>,
  updateAppSettings: (input: AppSettingsPatch): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC_CHANNELS.appSettingsUpdate, input) as Promise<AppSettings>,
  resetAppSettings: (): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC_CHANNELS.appSettingsReset) as Promise<AppSettings>,
  getCaptchaSettings: (): Promise<CaptchaSettingsView> =>
    ipcRenderer.invoke(IPC_CHANNELS.captchaSettingsGet) as Promise<CaptchaSettingsView>,
  saveCaptchaSettings: (input: SaveCaptchaSettingsInput): Promise<CaptchaSettingsView> =>
    ipcRenderer.invoke(IPC_CHANNELS.captchaSettingsSave, input) as Promise<CaptchaSettingsView>
}

contextBridge.exposeInMainWorld('pageAuto', api)

export type PageAutoApi = typeof api
