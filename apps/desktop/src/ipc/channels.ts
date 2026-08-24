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
import type { BrowserExecutableResult, BrowserTestRequest, BrowserTestResult } from '../shared/browserSettings'
import type {
  BrowserDisplayInfo,
  BrowserRetileResult,
  BrowserWindowLayoutSettings
} from '../shared/browserWindowLayout'
import type { CaptchaSettingsView, SaveCaptchaSettingsInput } from '../shared/captchaSettings'
import type { ConfigBackupExportResult, ConfigBackupRestoreResult } from '../shared/configBackup'
import type {
  ExecutionLogFilters,
  ExecutionLogRecord,
  RetryRunItemPayload,
  RetryRunItemResult
} from '../shared/executionLogs'
import type { LogCleanupResult } from '../shared/loggingMaintenance'
import type {
  CreatePageTabInput,
  ImageFolderInspection,
  PageTabConfig,
  PageTabIdPayload,
  PageTabPostLibrary,
  PageTabSummary,
  PickTextFileResult,
  SavePageTabPostLibraryInput,
  UpdatePageTabPayload
} from '../shared/pageTabs'
import type { ExecuteSinglePostingJobPayload, ExecuteSinglePostingJobResult } from '../shared/posting'
import type { RotationPageTabPayload, RotationRuntimeSnapshot } from '../shared/rotation'
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
  pageTabsPostLibraryGet: 'page-tabs:post-library:get',
  pageTabsPostLibrarySave: 'page-tabs:post-library:save',
  pageTabsPickImageFolder: 'page-tabs:pick-image-folder',
  pageTabsInspectImageFolder: 'page-tabs:inspect-image-folder',
  pageTabsPickTextFile: 'page-tabs:pick-text-file',
  runsLatestForPageTab: 'runs:latest-for-page-tab',
  runsCreate: 'runs:create',
  runsPause: 'runs:pause',
  runsResume: 'runs:resume',
  postingExecuteSingle: 'posting:execute-single',
  rotationList: 'rotation:list',
  rotationStatus: 'rotation:status',
  rotationStart: 'rotation:start',
  rotationPause: 'rotation:pause',
  rotationResume: 'rotation:resume',
  rotationStop: 'rotation:stop',
  executionLogsList: 'execution-logs:list',
  executionLogsRetryItem: 'execution-logs:retry-item',
  executionLogsCleanup: 'execution-logs:cleanup',
  configBackupExport: 'config-backup:export',
  configBackupRestore: 'config-backup:restore',
  appSettingsGet: 'settings:app:get',
  appSettingsUpdate: 'settings:app:update',
  appSettingsReset: 'settings:app:reset',
  browserDetect: 'settings:browser:detect',
  browserPickExecutable: 'settings:browser:pick-executable',
  browserProbeExecutable: 'settings:browser:probe-executable',
  browserTest: 'settings:browser:test',
  browserWindowLayoutGet: 'settings:browser-window-layout:get',
  browserWindowLayoutSave: 'settings:browser-window-layout:save',
  browserDisplaysList: 'settings:browser-window-layout:displays',
  browserRetile: 'settings:browser-window-layout:retile',
  captchaSettingsGet: 'settings:captcha:get',
  captchaSettingsSave: 'settings:captcha:save'
} as const

export interface AppInfo {
  name: string
  version: string
  isPackaged: boolean
  dataDirectory: string
}

export interface AccountUpdatePayload { id: number; patch: Partial<AccountDraft> }
export interface AccountDeletePayload { ids: number[] }
export interface AccountColumnLayoutPayload { layout: AccountColumnLayout }
export interface AccountOpenProfilePayload { accountId: number }

export interface PageAutoIpcContract {
  getAppInfo: () => Promise<AppInfo>
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
  getPageTabPostLibrary: (payload: PageTabIdPayload) => Promise<PageTabPostLibrary>
  savePageTabPostLibrary: (payload: SavePageTabPostLibraryInput) => Promise<PageTabPostLibrary>
  pickPageTabImageFolder: () => Promise<string | null>
  inspectPageTabImageFolder: (folderPath: string) => Promise<ImageFolderInspection>
  pickPageTabTextFile: () => Promise<PickTextFileResult | null>
  getLatestRunForPageTab: (payload: CreateRunPayload) => Promise<RunDetails | null>
  createRun: (payload: CreateRunPayload) => Promise<RunDetails>
  pauseRun: (payload: RunIdPayload) => Promise<RunDetails>
  resumeRun: (payload: RunIdPayload) => Promise<RunDetails>
  executeSinglePostingJob: (payload: ExecuteSinglePostingJobPayload) => Promise<ExecuteSinglePostingJobResult>
  listPageTabRotations: () => Promise<RotationRuntimeSnapshot[]>
  getPageTabRotationStatus: (payload: RotationPageTabPayload) => Promise<RotationRuntimeSnapshot>
  startPageTabRotation: (payload: RotationPageTabPayload) => Promise<RotationRuntimeSnapshot>
  pausePageTabRotation: (payload: RotationPageTabPayload) => Promise<RotationRuntimeSnapshot>
  resumePageTabRotation: (payload: RotationPageTabPayload) => Promise<RotationRuntimeSnapshot>
  stopPageTabRotation: (payload: RotationPageTabPayload) => Promise<RotationRuntimeSnapshot>
  listExecutionLogs: (filters?: ExecutionLogFilters) => Promise<ExecutionLogRecord[]>
  retryExecutionLogItem: (payload: RetryRunItemPayload) => Promise<RetryRunItemResult>
  cleanupExecutionLogs: () => Promise<LogCleanupResult>
  exportConfigBackup: () => Promise<ConfigBackupExportResult>
  restoreConfigBackup: () => Promise<ConfigBackupRestoreResult>
  getAppSettings: () => Promise<AppSettings>
  updateAppSettings: (input: AppSettingsPatch) => Promise<AppSettings>
  resetAppSettings: () => Promise<AppSettings>
  detectChrome: () => Promise<BrowserExecutableResult>
  pickChromeExecutable: () => Promise<BrowserExecutableResult>
  probeChromeExecutable: (executablePath: string) => Promise<BrowserExecutableResult>
  testBrowser: (input: BrowserTestRequest) => Promise<BrowserTestResult>
  getBrowserWindowLayout: () => Promise<BrowserWindowLayoutSettings>
  saveBrowserWindowLayout: (input: BrowserWindowLayoutSettings) => Promise<BrowserWindowLayoutSettings>
  listBrowserDisplays: () => Promise<BrowserDisplayInfo[]>
  retileBrowserWindows: () => Promise<BrowserRetileResult>
  getCaptchaSettings: () => Promise<CaptchaSettingsView>
  saveCaptchaSettings: (input: SaveCaptchaSettingsInput) => Promise<CaptchaSettingsView>
}
