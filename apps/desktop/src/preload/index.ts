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
import {
  ACCOUNT_BROWSER_DOCK_IPC,
  type AccountBrowserDockOpenResult
} from '../shared/accountBrowserDock'
import {
  ACCOUNT_GROUP_IPC,
  type AccountGroupIdPayload,
  type AccountGroupOverview,
  type AccountGroupRecord,
  type AssignAccountsToGroupInput,
  type CreateAccountGroupInput,
  type RenameAccountGroupInput
} from '../shared/accountGroups'
import {
  ACTION_WORKSPACE_IPC,
  type ActionWorkspaceIdPayload,
  type ActionWorkspaceRecord,
  type CreateActionWorkspaceInput,
  type UpdateActionWorkspacePayload
} from '../shared/actionWorkspaces'
import {
  INTERACTION_WORKSPACE_RUNNER_IPC,
  type InteractionWorkspaceRunIdPayload,
  type InteractionWorkspaceRunSnapshot,
  type InteractionWorkspaceRunStartPayload
} from '../shared/interactionWorkspaceRunner'
import {
  AI_AGENT_IPC,
  type AiAgentCatalogView,
  type AiAgentEnabledPayload,
  type AiAgentIdPayload,
  type AiAgentImportResult,
  type GenerateAiPostsInput,
  type GenerateAiPostsResult,
  type SaveGeminiApiKeyInput
} from '../shared/aiAgents'
import type { AppSettings, AppSettingsPatch } from '../shared/appSettings'
import type { BrowserExecutableResult, BrowserTestRequest, BrowserTestResult } from '../shared/browserSettings'
import type { BrowserDisplayInfo, BrowserRetileResult, BrowserWindowLayoutSettings } from '../shared/browserWindowLayout'
import type { CaptchaSettingsView, SaveCaptchaSettingsInput } from '../shared/captchaSettings'
import {
  CHECKPOINT282_WORKBENCH_IPC,
  type FacebookCheckpoint282AssetPreview,
  type FacebookCheckpoint282AssetPreviewRequest,
  type FacebookCheckpoint282HistoryEntry,
  type FacebookCheckpoint282HistoryRequest,
  type FacebookCheckpoint282PreflightRequest,
  type FacebookCheckpoint282PreflightResult,
  type FacebookCheckpoint282Preset,
  type FacebookCheckpoint282ResolveDuplicateRequest,
  type FacebookCheckpoint282ResolveDuplicateResult
} from '../shared/checkpoint282Workbench'
import {
  CONTENT_LIBRARY_IPC,
  type ContentLibraryItemIdPayload,
  type ContentLibrarySetDetails,
  type ContentLibrarySetIdPayload,
  type ContentLibrarySetSummary,
  type ContentLibraryTextFileResult,
  type CreateContentLibraryItemInput,
  type CreateContentLibrarySetInput,
  type MoveContentLibraryItemInput,
  type RenameContentLibrarySetInput,
  type UpdateContentLibraryItemInput
} from '../shared/contentLibrary'
import {
  COPY_POST_IPC,
  type CopyPostSaveRequest,
  type CopyPostSaveResult,
  type CopyPostScanItem,
  type CopyPostScanRequest
} from '../shared/copyPost'
import type { ConfigBackupExportResult, ConfigBackupRestoreResult } from '../shared/configBackup'
import type { HotmailComboActionPayload, HotmailComboBatchResult } from '../shared/emailCombo'
import type { ExecutionLogFilters, ExecutionLogRecord, RetryRunItemPayload, RetryRunItemResult } from '../shared/executionLogs'
import type { FacebookCheckpoint282RunPayload, FacebookCheckpoint282Result } from '../shared/facebookCheckpoint'
import type {
  HotmailAccountPayload,
  HotmailBatchPayload,
  HotmailBatchResult,
  HotmailBrowserOpenResult,
  HotmailDashboardRow,
  HotmailOAuthStartResult,
  HotmailPasswordActionPayload,
  HotmailPasswordBatchResult,
  HotmailProxyStatus,
  HotmailProxyTestResult,
  HotmailRecoveryActionPayload,
  HotmailRecoveryBatchResult,
  HotmailSettingsView,
  SaveHotmailSettingsInput
} from '../shared/hotmail'
import type { LogCleanupResult } from '../shared/loggingMaintenance'
import type { CreatePageTabInput, ImageFolderInspection, PageTabConfig, PageTabIdPayload, PageTabPostLibrary, PageTabSummary, PickTextFileResult, SavePageTabPostLibraryInput, UpdatePageTabPayload } from '../shared/pageTabs'
import type { PageWallRunNowPayload, PageWallRunNowResult } from '../shared/pageWall'
import type { PageWallJobIdPayload, PageWallJobRecord, PageWallSchedulePayload } from '../shared/pageWallJobs'
import type { ExecuteSinglePostingJobPayload, ExecuteSinglePostingJobResult } from '../shared/posting'
import type { RotationPageTabPayload, RotationRuntimeSnapshot } from '../shared/rotation'
import type { CreateRunPayload, RunDetails, RunIdPayload } from '../shared/runs'
import {
  SCENARIO_IPC,
  type CreateScenarioActionInput,
  type CreateScenarioInput,
  type MoveScenarioActionPayload,
  type ScenarioActionIdPayload,
  type ScenarioDetails,
  type ScenarioIdPayload,
  type ScenarioSummary,
  type UpdateScenarioActionPayload,
  type UpdateScenarioPayload
} from '../shared/scenarios'
import {
  SCENARIO_RUNNER_IPC,
  type ScenarioRunnerSnapshot,
  type ScenarioRunnerStartPayload
} from '../shared/scenarioRunnerRuntime'
import {
  STORY_IPC,
  type CreateStoryInput,
  type StoryRecord,
  type UpdateStoryInput
} from '../shared/story'

const api = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC_CHANNELS.appInfo) as Promise<AppInfo>,
  listAccounts: (filters?: AccountListFilters): Promise<AccountRecord[]> => ipcRenderer.invoke(IPC_CHANNELS.accountsList, filters) as Promise<AccountRecord[]>,
  createAccount: (input: AccountDraft): Promise<AccountRecord> => ipcRenderer.invoke(IPC_CHANNELS.accountsCreate, input) as Promise<AccountRecord>,
  updateAccount: (payload: AccountUpdatePayload): Promise<AccountRecord> => ipcRenderer.invoke(IPC_CHANNELS.accountsUpdate, payload) as Promise<AccountRecord>,
  deleteAccounts: (payload: AccountDeletePayload): Promise<number> => ipcRenderer.invoke(IPC_CHANNELS.accountsDelete, payload) as Promise<number>,
  importAccounts: (request: AccountImportRequest): Promise<AccountImportResult> => ipcRenderer.invoke(IPC_CHANNELS.accountsImport, request) as Promise<AccountImportResult>,
  listImportPresets: (): Promise<ImportPreset[]> => ipcRenderer.invoke(IPC_CHANNELS.accountPresetsList) as Promise<ImportPreset[]>,
  saveImportPreset: (input: SaveImportPresetInput): Promise<ImportPreset> => ipcRenderer.invoke(IPC_CHANNELS.accountPresetsSave, input) as Promise<ImportPreset>,
  deleteImportPreset: (id: number): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.accountPresetsDelete, id) as Promise<boolean>,
  getAccountColumnLayout: (): Promise<AccountColumnLayout | null> => ipcRenderer.invoke(IPC_CHANNELS.accountColumnLayoutGet) as Promise<AccountColumnLayout | null>,
  saveAccountColumnLayout: (payload: AccountColumnLayoutPayload): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.accountColumnLayoutSave, payload) as Promise<void>,
  getAccountGroupOverview: (): Promise<AccountGroupOverview> => ipcRenderer.invoke(ACCOUNT_GROUP_IPC.overview) as Promise<AccountGroupOverview>,
  createAccountGroup: (input: CreateAccountGroupInput): Promise<AccountGroupRecord> => ipcRenderer.invoke(ACCOUNT_GROUP_IPC.create, input) as Promise<AccountGroupRecord>,
  renameAccountGroup: (input: RenameAccountGroupInput): Promise<AccountGroupRecord> => ipcRenderer.invoke(ACCOUNT_GROUP_IPC.rename, input) as Promise<AccountGroupRecord>,
  deleteAccountGroup: (payload: AccountGroupIdPayload): Promise<boolean> => ipcRenderer.invoke(ACCOUNT_GROUP_IPC.delete, payload) as Promise<boolean>,
  assignAccountsToGroup: (input: AssignAccountsToGroupInput): Promise<number> => ipcRenderer.invoke(ACCOUNT_GROUP_IPC.assign, input) as Promise<number>,
  listActionWorkspaces: (): Promise<ActionWorkspaceRecord[]> => ipcRenderer.invoke(ACTION_WORKSPACE_IPC.list) as Promise<ActionWorkspaceRecord[]>,
  createActionWorkspace: (input: CreateActionWorkspaceInput): Promise<ActionWorkspaceRecord> => ipcRenderer.invoke(ACTION_WORKSPACE_IPC.create, input) as Promise<ActionWorkspaceRecord>,
  updateActionWorkspace: (payload: UpdateActionWorkspacePayload): Promise<ActionWorkspaceRecord> => ipcRenderer.invoke(ACTION_WORKSPACE_IPC.update, payload) as Promise<ActionWorkspaceRecord>,
  deleteActionWorkspace: (payload: ActionWorkspaceIdPayload): Promise<boolean> => ipcRenderer.invoke(ACTION_WORKSPACE_IPC.delete, payload) as Promise<boolean>,
  startInteractionWorkspaceRunner: (payload: InteractionWorkspaceRunStartPayload): Promise<InteractionWorkspaceRunSnapshot> => ipcRenderer.invoke(INTERACTION_WORKSPACE_RUNNER_IPC.start, payload) as Promise<InteractionWorkspaceRunSnapshot>,
  getInteractionWorkspaceRunnerStatus: (payload: InteractionWorkspaceRunIdPayload): Promise<InteractionWorkspaceRunSnapshot | null> => ipcRenderer.invoke(INTERACTION_WORKSPACE_RUNNER_IPC.status, payload) as Promise<InteractionWorkspaceRunSnapshot | null>,
  pauseInteractionWorkspaceRunner: (payload: InteractionWorkspaceRunIdPayload): Promise<InteractionWorkspaceRunSnapshot | null> => ipcRenderer.invoke(INTERACTION_WORKSPACE_RUNNER_IPC.pause, payload) as Promise<InteractionWorkspaceRunSnapshot | null>,
  resumeInteractionWorkspaceRunner: (payload: InteractionWorkspaceRunIdPayload): Promise<InteractionWorkspaceRunSnapshot | null> => ipcRenderer.invoke(INTERACTION_WORKSPACE_RUNNER_IPC.resume, payload) as Promise<InteractionWorkspaceRunSnapshot | null>,
  stopInteractionWorkspaceRunner: (payload: InteractionWorkspaceRunIdPayload): Promise<InteractionWorkspaceRunSnapshot | null> => ipcRenderer.invoke(INTERACTION_WORKSPACE_RUNNER_IPC.stop, payload) as Promise<InteractionWorkspaceRunSnapshot | null>,
  getAiAgentCatalog: (): Promise<AiAgentCatalogView> => ipcRenderer.invoke(AI_AGENT_IPC.catalog) as Promise<AiAgentCatalogView>,
  importAiAgentJson: (): Promise<AiAgentImportResult | null> => ipcRenderer.invoke(AI_AGENT_IPC.importJson) as Promise<AiAgentImportResult | null>,
  setAiAgentEnabled: (payload: AiAgentEnabledPayload): Promise<AiAgentCatalogView> => ipcRenderer.invoke(AI_AGENT_IPC.setEnabled, payload) as Promise<AiAgentCatalogView>,
  setDefaultAiAgent: (payload: AiAgentIdPayload): Promise<AiAgentCatalogView> => ipcRenderer.invoke(AI_AGENT_IPC.setDefault, payload) as Promise<AiAgentCatalogView>,
  deleteAiAgent: (payload: AiAgentIdPayload): Promise<AiAgentCatalogView> => ipcRenderer.invoke(AI_AGENT_IPC.delete, payload) as Promise<AiAgentCatalogView>,
  saveGeminiApiKey: (input: SaveGeminiApiKeyInput): Promise<AiAgentCatalogView> => ipcRenderer.invoke(AI_AGENT_IPC.saveGeminiApiKey, input) as Promise<AiAgentCatalogView>,
  clearGeminiApiKey: (): Promise<AiAgentCatalogView> => ipcRenderer.invoke(AI_AGENT_IPC.clearGeminiApiKey) as Promise<AiAgentCatalogView>,
  generateAiPosts: (input: GenerateAiPostsInput): Promise<GenerateAiPostsResult> => ipcRenderer.invoke(AI_AGENT_IPC.generatePosts, input) as Promise<GenerateAiPostsResult>,
  listContentLibraries: (): Promise<ContentLibrarySetSummary[]> => ipcRenderer.invoke(CONTENT_LIBRARY_IPC.list) as Promise<ContentLibrarySetSummary[]>,
  getContentLibrary: (payload: ContentLibrarySetIdPayload): Promise<ContentLibrarySetDetails | null> => ipcRenderer.invoke(CONTENT_LIBRARY_IPC.get, payload) as Promise<ContentLibrarySetDetails | null>,
  createContentLibrary: (input: CreateContentLibrarySetInput): Promise<ContentLibrarySetDetails> => ipcRenderer.invoke(CONTENT_LIBRARY_IPC.createSet, input) as Promise<ContentLibrarySetDetails>,
  renameContentLibrary: (input: RenameContentLibrarySetInput): Promise<ContentLibrarySetDetails> => ipcRenderer.invoke(CONTENT_LIBRARY_IPC.renameSet, input) as Promise<ContentLibrarySetDetails>,
  deleteContentLibrary: (payload: ContentLibrarySetIdPayload): Promise<boolean> => ipcRenderer.invoke(CONTENT_LIBRARY_IPC.deleteSet, payload) as Promise<boolean>,
  createContentLibraryItem: (input: CreateContentLibraryItemInput): Promise<ContentLibrarySetDetails> => ipcRenderer.invoke(CONTENT_LIBRARY_IPC.createItem, input) as Promise<ContentLibrarySetDetails>,
  updateContentLibraryItem: (input: UpdateContentLibraryItemInput): Promise<ContentLibrarySetDetails> => ipcRenderer.invoke(CONTENT_LIBRARY_IPC.updateItem, input) as Promise<ContentLibrarySetDetails>,
  deleteContentLibraryItem: (payload: ContentLibraryItemIdPayload): Promise<ContentLibrarySetDetails> => ipcRenderer.invoke(CONTENT_LIBRARY_IPC.deleteItem, payload) as Promise<ContentLibrarySetDetails>,
  moveContentLibraryItem: (input: MoveContentLibraryItemInput): Promise<ContentLibrarySetDetails> => ipcRenderer.invoke(CONTENT_LIBRARY_IPC.moveItem, input) as Promise<ContentLibrarySetDetails>,
  pickContentLibraryImageFolder: (): Promise<string | null> => ipcRenderer.invoke(CONTENT_LIBRARY_IPC.pickImageFolder) as Promise<string | null>,
  pickContentLibraryTextFile: (): Promise<ContentLibraryTextFileResult | null> => ipcRenderer.invoke(CONTENT_LIBRARY_IPC.pickTextFile) as Promise<ContentLibraryTextFileResult | null>,
  scanCopyPosts: (input: CopyPostScanRequest): Promise<CopyPostScanItem[]> => ipcRenderer.invoke(COPY_POST_IPC.scan, input) as Promise<CopyPostScanItem[]>,
  pickCopyPostMediaFolder: (): Promise<string | null> => ipcRenderer.invoke(COPY_POST_IPC.pickMediaFolder) as Promise<string | null>,
  saveCopyPosts: (input: CopyPostSaveRequest): Promise<CopyPostSaveResult> => ipcRenderer.invoke(COPY_POST_IPC.saveSelected, input) as Promise<CopyPostSaveResult>,
  listStories: (): Promise<StoryRecord[]> => ipcRenderer.invoke(STORY_IPC.list) as Promise<StoryRecord[]>,
  createStory: (input: CreateStoryInput): Promise<StoryRecord> => ipcRenderer.invoke(STORY_IPC.create, input) as Promise<StoryRecord>,
  updateStory: (input: UpdateStoryInput): Promise<StoryRecord> => ipcRenderer.invoke(STORY_IPC.update, input) as Promise<StoryRecord>,
  pickStoryMediaFile: (): Promise<string | null> => ipcRenderer.invoke(STORY_IPC.pickMediaFile) as Promise<string | null>,
  pickStoryMediaFolder: (): Promise<string | null> => ipcRenderer.invoke(STORY_IPC.pickMediaFolder) as Promise<string | null>,
  openAccountProfile: (payload: AccountOpenProfilePayload): Promise<BrowserProfileResult> => ipcRenderer.invoke(IPC_CHANNELS.accountOpenProfile, payload) as Promise<BrowserProfileResult>,
  openAccountBrowserDock: (): Promise<AccountBrowserDockOpenResult> => ipcRenderer.invoke(ACCOUNT_BROWSER_DOCK_IPC.open) as Promise<AccountBrowserDockOpenResult>,
  runFacebookCheckpoint282: (payload: FacebookCheckpoint282RunPayload): Promise<FacebookCheckpoint282Result> => ipcRenderer.invoke(IPC_CHANNELS.facebookCheckpoint282Run, payload) as Promise<FacebookCheckpoint282Result>,
  getFacebookCheckpoint282Preset: (): Promise<FacebookCheckpoint282Preset> => ipcRenderer.invoke(CHECKPOINT282_WORKBENCH_IPC.getPreset) as Promise<FacebookCheckpoint282Preset>,
  saveFacebookCheckpoint282Preset: (input: FacebookCheckpoint282Preset): Promise<FacebookCheckpoint282Preset> => ipcRenderer.invoke(CHECKPOINT282_WORKBENCH_IPC.savePreset, input) as Promise<FacebookCheckpoint282Preset>,
  pickFacebookCheckpoint282SourceFolder: (): Promise<string | null> => ipcRenderer.invoke(CHECKPOINT282_WORKBENCH_IPC.pickSourceFolder) as Promise<string | null>,
  preflightFacebookCheckpoint282: (input: FacebookCheckpoint282PreflightRequest): Promise<FacebookCheckpoint282PreflightResult> => ipcRenderer.invoke(CHECKPOINT282_WORKBENCH_IPC.preflight, input) as Promise<FacebookCheckpoint282PreflightResult>,
  previewFacebookCheckpoint282Asset: (input: FacebookCheckpoint282AssetPreviewRequest): Promise<FacebookCheckpoint282AssetPreview> => ipcRenderer.invoke(CHECKPOINT282_WORKBENCH_IPC.previewAsset, input) as Promise<FacebookCheckpoint282AssetPreview>,
  resolveFacebookCheckpoint282Duplicate: (input: FacebookCheckpoint282ResolveDuplicateRequest): Promise<FacebookCheckpoint282ResolveDuplicateResult> => ipcRenderer.invoke(CHECKPOINT282_WORKBENCH_IPC.resolveDuplicate, input) as Promise<FacebookCheckpoint282ResolveDuplicateResult>,
  getFacebookCheckpoint282History: (input: FacebookCheckpoint282HistoryRequest): Promise<FacebookCheckpoint282HistoryEntry[]> => ipcRenderer.invoke(CHECKPOINT282_WORKBENCH_IPC.history, input) as Promise<FacebookCheckpoint282HistoryEntry[]>,
  revealFacebookCheckpoint282Path: (path: string): Promise<boolean> => ipcRenderer.invoke(CHECKPOINT282_WORKBENCH_IPC.revealPath, path) as Promise<boolean>,
  pickFacebookCheckpointEvidenceFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.facebookCheckpointEvidenceFolderPick) as Promise<string | null>,
  listHotmailDashboard: (): Promise<HotmailDashboardRow[]> => ipcRenderer.invoke(IPC_CHANNELS.hotmailDashboardList) as Promise<HotmailDashboardRow[]>,
  getHotmailSettings: (): Promise<HotmailSettingsView> => ipcRenderer.invoke(IPC_CHANNELS.hotmailSettingsGet) as Promise<HotmailSettingsView>,
  saveHotmailSettings: (input: SaveHotmailSettingsInput): Promise<HotmailSettingsView> => ipcRenderer.invoke(IPC_CHANNELS.hotmailSettingsSave, input) as Promise<HotmailSettingsView>,
  pickHotmailProfileRoot: (): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.hotmailPickProfileRoot) as Promise<string | null>,
  pickHotmailBrowserExecutable: (): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.hotmailPickBrowserExecutable) as Promise<string | null>,
  startHotmailOAuth: (payload: HotmailAccountPayload): Promise<HotmailOAuthStartResult> => ipcRenderer.invoke(IPC_CHANNELS.hotmailOAuthStart, payload) as Promise<HotmailOAuthStartResult>,
  getHotmailCodes: (payload: HotmailBatchPayload): Promise<HotmailBatchResult> => ipcRenderer.invoke(IPC_CHANNELS.hotmailCodesGet, payload) as Promise<HotmailBatchResult>,
  checkHotmail: (payload: HotmailBatchPayload): Promise<HotmailBatchResult> => ipcRenderer.invoke(IPC_CHANNELS.hotmailCheck, payload) as Promise<HotmailBatchResult>,
  openHotmail: (payload: HotmailAccountPayload): Promise<HotmailBrowserOpenResult> => ipcRenderer.invoke(IPC_CHANNELS.hotmailOpen, payload) as Promise<HotmailBrowserOpenResult>,
  updateHotmailRecovery: (payload: HotmailRecoveryActionPayload): Promise<HotmailRecoveryBatchResult> => ipcRenderer.invoke(IPC_CHANNELS.hotmailRecoveryAction, payload) as Promise<HotmailRecoveryBatchResult>,
  updateHotmailPassword: (payload: HotmailPasswordActionPayload): Promise<HotmailPasswordBatchResult> => ipcRenderer.invoke(IPC_CHANNELS.hotmailPasswordAction, payload) as Promise<HotmailPasswordBatchResult>,
  runHotmailCombo: (payload: HotmailComboActionPayload): Promise<HotmailComboBatchResult> => ipcRenderer.invoke(IPC_CHANNELS.hotmailComboAction, payload) as Promise<HotmailComboBatchResult>,
  getHotmailProxyStatus: (): Promise<HotmailProxyStatus> => ipcRenderer.invoke(IPC_CHANNELS.hotmailProxyStatus) as Promise<HotmailProxyStatus>,
  rotateHotmailProxy: (): Promise<HotmailProxyStatus> => ipcRenderer.invoke(IPC_CHANNELS.hotmailProxyRotate) as Promise<HotmailProxyStatus>,
  testHotmailProxy: (): Promise<HotmailProxyTestResult> => ipcRenderer.invoke(IPC_CHANNELS.hotmailProxyTest) as Promise<HotmailProxyTestResult>,
  listPageTabs: (): Promise<PageTabSummary[]> => ipcRenderer.invoke(IPC_CHANNELS.pageTabsList) as Promise<PageTabSummary[]>,
  getPageTab: (payload: PageTabIdPayload): Promise<PageTabConfig | null> => ipcRenderer.invoke(IPC_CHANNELS.pageTabsGet, payload) as Promise<PageTabConfig | null>,
  createPageTab: (input: CreatePageTabInput): Promise<PageTabConfig> => ipcRenderer.invoke(IPC_CHANNELS.pageTabsCreate, input) as Promise<PageTabConfig>,
  updatePageTab: (payload: UpdatePageTabPayload): Promise<PageTabConfig> => ipcRenderer.invoke(IPC_CHANNELS.pageTabsUpdate, payload) as Promise<PageTabConfig>,
  deletePageTab: (payload: PageTabIdPayload): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.pageTabsDelete, payload) as Promise<boolean>,
  duplicatePageTab: (payload: PageTabIdPayload): Promise<PageTabConfig> => ipcRenderer.invoke(IPC_CHANNELS.pageTabsDuplicate, payload) as Promise<PageTabConfig>,
  getPageTabPostLibrary: (payload: PageTabIdPayload): Promise<PageTabPostLibrary> => ipcRenderer.invoke(IPC_CHANNELS.pageTabsPostLibraryGet, payload) as Promise<PageTabPostLibrary>,
  savePageTabPostLibrary: (payload: SavePageTabPostLibraryInput): Promise<PageTabPostLibrary> => ipcRenderer.invoke(IPC_CHANNELS.pageTabsPostLibrarySave, payload) as Promise<PageTabPostLibrary>,
  pickPageTabImageFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.pageTabsPickImageFolder) as Promise<string | null>,
  inspectPageTabImageFolder: (folderPath: string): Promise<ImageFolderInspection> => ipcRenderer.invoke(IPC_CHANNELS.pageTabsInspectImageFolder, folderPath) as Promise<ImageFolderInspection>,
  pickPageTabTextFile: (): Promise<PickTextFileResult | null> => ipcRenderer.invoke(IPC_CHANNELS.pageTabsPickTextFile) as Promise<PickTextFileResult | null>,
  listScenarios: (): Promise<ScenarioSummary[]> => ipcRenderer.invoke(SCENARIO_IPC.list) as Promise<ScenarioSummary[]>,
  getScenario: (payload: ScenarioIdPayload): Promise<ScenarioDetails | null> => ipcRenderer.invoke(SCENARIO_IPC.get, payload) as Promise<ScenarioDetails | null>,
  createScenario: (input: CreateScenarioInput): Promise<ScenarioDetails> => ipcRenderer.invoke(SCENARIO_IPC.create, input) as Promise<ScenarioDetails>,
  updateScenario: (payload: UpdateScenarioPayload): Promise<ScenarioDetails> => ipcRenderer.invoke(SCENARIO_IPC.update, payload) as Promise<ScenarioDetails>,
  deleteScenario: (payload: ScenarioIdPayload): Promise<boolean> => ipcRenderer.invoke(SCENARIO_IPC.delete, payload) as Promise<boolean>,
  createScenarioAction: (input: CreateScenarioActionInput): Promise<ScenarioDetails> => ipcRenderer.invoke(SCENARIO_IPC.actionCreate, input) as Promise<ScenarioDetails>,
  updateScenarioAction: (payload: UpdateScenarioActionPayload): Promise<ScenarioDetails> => ipcRenderer.invoke(SCENARIO_IPC.actionUpdate, payload) as Promise<ScenarioDetails>,
  deleteScenarioAction: (payload: ScenarioActionIdPayload): Promise<ScenarioDetails> => ipcRenderer.invoke(SCENARIO_IPC.actionDelete, payload) as Promise<ScenarioDetails>,
  moveScenarioAction: (payload: MoveScenarioActionPayload): Promise<ScenarioDetails> => ipcRenderer.invoke(SCENARIO_IPC.actionMove, payload) as Promise<ScenarioDetails>,
  startScenarioRunner: (payload: ScenarioRunnerStartPayload): Promise<ScenarioRunnerSnapshot> => ipcRenderer.invoke(SCENARIO_RUNNER_IPC.start, payload) as Promise<ScenarioRunnerSnapshot>,
  getScenarioRunnerStatus: (): Promise<ScenarioRunnerSnapshot | null> => ipcRenderer.invoke(SCENARIO_RUNNER_IPC.status) as Promise<ScenarioRunnerSnapshot | null>,
  stopScenarioRunner: (): Promise<ScenarioRunnerSnapshot | null> => ipcRenderer.invoke(SCENARIO_RUNNER_IPC.stop) as Promise<ScenarioRunnerSnapshot | null>,
  pickPageWallImages: (): Promise<string[]> => ipcRenderer.invoke(IPC_CHANNELS.pageWallPickImages) as Promise<string[]>,
  runPageWallNow: (payload: PageWallRunNowPayload): Promise<PageWallRunNowResult> => ipcRenderer.invoke(IPC_CHANNELS.pageWallRunNow, payload) as Promise<PageWallRunNowResult>,
  schedulePageWall: (payload: PageWallSchedulePayload): Promise<PageWallJobRecord> => ipcRenderer.invoke(IPC_CHANNELS.pageWallSchedule, payload) as Promise<PageWallJobRecord>,
  listPageWallJobs: (): Promise<PageWallJobRecord[]> => ipcRenderer.invoke(IPC_CHANNELS.pageWallJobsList) as Promise<PageWallJobRecord[]>,
  cancelPageWallJob: (payload: PageWallJobIdPayload): Promise<PageWallJobRecord> => ipcRenderer.invoke(IPC_CHANNELS.pageWallJobCancel, payload) as Promise<PageWallJobRecord>,
  getLatestRunForPageTab: (payload: CreateRunPayload): Promise<RunDetails | null> => ipcRenderer.invoke(IPC_CHANNELS.runsLatestForPageTab, payload) as Promise<RunDetails | null>,
  createRun: (payload: CreateRunPayload): Promise<RunDetails> => ipcRenderer.invoke(IPC_CHANNELS.runsCreate, payload) as Promise<RunDetails>,
  pauseRun: (payload: RunIdPayload): Promise<RunDetails> => ipcRenderer.invoke(IPC_CHANNELS.runsPause, payload) as Promise<RunDetails>,
  resumeRun: (payload: RunIdPayload): Promise<RunDetails> => ipcRenderer.invoke(IPC_CHANNELS.runsResume, payload) as Promise<RunDetails>,
  executeSinglePostingJob: (payload: ExecuteSinglePostingJobPayload): Promise<ExecuteSinglePostingJobResult> => ipcRenderer.invoke(IPC_CHANNELS.postingExecuteSingle, payload) as Promise<ExecuteSinglePostingJobResult>,
  listPageTabRotations: (): Promise<RotationRuntimeSnapshot[]> => ipcRenderer.invoke(IPC_CHANNELS.rotationList) as Promise<RotationRuntimeSnapshot[]>,
  getPageTabRotationStatus: (payload: RotationPageTabPayload): Promise<RotationRuntimeSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.rotationStatus, payload) as Promise<RotationRuntimeSnapshot>,
  startPageTabRotation: (payload: RotationPageTabPayload): Promise<RotationRuntimeSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.rotationStart, payload) as Promise<RotationRuntimeSnapshot>,
  pausePageTabRotation: (payload: RotationPageTabPayload): Promise<RotationRuntimeSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.rotationPause, payload) as Promise<RotationRuntimeSnapshot>,
  resumePageTabRotation: (payload: RotationPageTabPayload): Promise<RotationRuntimeSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.rotationResume, payload) as Promise<RotationRuntimeSnapshot>,
  stopPageTabRotation: (payload: RotationPageTabPayload): Promise<RotationRuntimeSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.rotationStop, payload) as Promise<RotationRuntimeSnapshot>,
  listExecutionLogs: (filters?: ExecutionLogFilters): Promise<ExecutionLogRecord[]> => ipcRenderer.invoke(IPC_CHANNELS.executionLogsList, filters) as Promise<ExecutionLogRecord[]>,
  retryExecutionLogItem: (payload: RetryRunItemPayload): Promise<RetryRunItemResult> => ipcRenderer.invoke(IPC_CHANNELS.executionLogsRetryItem, payload) as Promise<RetryRunItemResult>,
  cleanupExecutionLogs: (): Promise<LogCleanupResult> => ipcRenderer.invoke(IPC_CHANNELS.executionLogsCleanup) as Promise<LogCleanupResult>,
  exportConfigBackup: (): Promise<ConfigBackupExportResult> => ipcRenderer.invoke(IPC_CHANNELS.configBackupExport) as Promise<ConfigBackupExportResult>,
  restoreConfigBackup: (): Promise<ConfigBackupRestoreResult> => ipcRenderer.invoke(IPC_CHANNELS.configBackupRestore) as Promise<ConfigBackupRestoreResult>,
  getAppSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC_CHANNELS.appSettingsGet) as Promise<AppSettings>,
  updateAppSettings: (input: AppSettingsPatch): Promise<AppSettings> => ipcRenderer.invoke(IPC_CHANNELS.appSettingsUpdate, input) as Promise<AppSettings>,
  resetAppSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC_CHANNELS.appSettingsReset) as Promise<AppSettings>,
  detectChrome: (): Promise<BrowserExecutableResult> => ipcRenderer.invoke(IPC_CHANNELS.browserDetect) as Promise<BrowserExecutableResult>,
  pickChromeExecutable: (): Promise<BrowserExecutableResult> => ipcRenderer.invoke(IPC_CHANNELS.browserPickExecutable) as Promise<BrowserExecutableResult>,
  pickFacebookProfileRoot: (): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.browserPickProfileRoot) as Promise<string | null>,
  probeChromeExecutable: (executablePath: string): Promise<BrowserExecutableResult> => ipcRenderer.invoke(IPC_CHANNELS.browserProbeExecutable, executablePath) as Promise<BrowserExecutableResult>,
  testBrowser: (input: BrowserTestRequest): Promise<BrowserTestResult> => ipcRenderer.invoke(IPC_CHANNELS.browserTest, input) as Promise<BrowserTestResult>,
  getBrowserWindowLayout: (): Promise<BrowserWindowLayoutSettings> => ipcRenderer.invoke(IPC_CHANNELS.browserWindowLayoutGet) as Promise<BrowserWindowLayoutSettings>,
  saveBrowserWindowLayout: (input: BrowserWindowLayoutSettings): Promise<BrowserWindowLayoutSettings> => ipcRenderer.invoke(IPC_CHANNELS.browserWindowLayoutSave, input) as Promise<BrowserWindowLayoutSettings>,
  listBrowserDisplays: (): Promise<BrowserDisplayInfo[]> => ipcRenderer.invoke(IPC_CHANNELS.browserDisplaysList) as Promise<BrowserDisplayInfo[]>,
  retileBrowserWindows: (): Promise<BrowserRetileResult> => ipcRenderer.invoke(IPC_CHANNELS.browserRetile) as Promise<BrowserRetileResult>,
  getCaptchaSettings: (): Promise<CaptchaSettingsView> => ipcRenderer.invoke(IPC_CHANNELS.captchaSettingsGet) as Promise<CaptchaSettingsView>,
  saveCaptchaSettings: (input: SaveCaptchaSettingsInput): Promise<CaptchaSettingsView> => ipcRenderer.invoke(IPC_CHANNELS.captchaSettingsSave, input) as Promise<CaptchaSettingsView>
}

contextBridge.exposeInMainWorld('pageAuto', api)
export type PageAutoApi = typeof api
