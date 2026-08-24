import { app, dialog, ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import {
  IPC_CHANNELS,
  type AccountColumnLayoutPayload,
  type AccountDeletePayload,
  type AccountOpenProfilePayload,
  type AccountUpdatePayload,
  type AppInfo
} from '../ipc/channels'
import type {
  AccountDraft,
  AccountImportRequest,
  AccountListFilters,
  SaveImportPresetInput
} from '../shared/accounts'
import { assertValidAppSettings, type AppSettingsPatch } from '../shared/appSettings'
import type { BrowserTestRequest } from '../shared/browserSettings'
import type { SaveCaptchaSettingsInput } from '../shared/captchaSettings'
import type { ConfigBackupRestoreResult } from '../shared/configBackup'
import type { ExecutionLogFilters, RetryRunItemPayload } from '../shared/executionLogs'
import type { CreatePageTabInput, PageTabIdPayload, UpdatePageTabPayload } from '../shared/pageTabs'
import type { ExecuteSinglePostingJobPayload } from '../shared/posting'
import type { RotationPageTabPayload } from '../shared/rotation'
import type { CreateRunPayload, RunIdPayload } from '../shared/runs'
import { BrowserEngineService } from './browser/browserEngineService'
import { BrowserProfileManager } from './browser/browserProfileManager'
import { AccountRepository } from './database/accountRepository'
import { AppSettingsRepository } from './database/appSettingsRepository'
import { CaptchaSettingsRepository } from './database/captchaSettingsRepository'
import { ExecutionLogRepository } from './database/executionLogRepository'
import { PageTabRepository } from './database/pageTabRepository'
import { RunRepository } from './database/runRepository'
import { AccountExecutionCoordinator } from './services/accountExecutionCoordinator'
import { ConfigBackupService } from './services/configBackupService'
import { LogMaintenanceService } from './services/logMaintenanceService'
import { PageTabWorkerManager } from './services/pageTabWorkerManager'
import { PostingService } from './services/postingService'
import { ResilientPostingService } from './services/resilientPostingService'
import { RotationService, type RotationPostingExecutor } from './services/rotationService'
import { RuntimeRecoveryService } from './services/runtimeRecovery'

interface RegisterIpcOptions {
  database: Database.Database
  dataDirectory: string
}

export interface IpcRuntime { dispose: () => void }

const supportedImageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const MAX_BACKUP_FILE_BYTES = 20 * 1024 * 1024

export function registerIpcHandlers(options: RegisterIpcOptions): IpcRuntime {
  const accounts = new AccountRepository(options.database)
  const appSettings = new AppSettingsRepository(options.database)
  const captchaSettings = new CaptchaSettingsRepository(options.database)
  const pageTabs = new PageTabRepository(options.database)
  const runs = new RunRepository(options.database)
  const executionLogs = new ExecutionLogRepository(options.database)
  const recovery = new RuntimeRecoveryService(options.database, executionLogs)
  const configBackup = new ConfigBackupService(options.database)
  const logMaintenance = new LogMaintenanceService(options.database, options.dataDirectory)
  const browserEngine = new BrowserEngineService()
  recovery.recoverInterruptedRuns()
  void logMaintenance.cleanup(appSettings.get().logging).catch(() => undefined)

  const browserProfiles = new BrowserProfileManager(options.dataDirectory, (session) => {
    const current = accounts.getById(session.accountId)
    if (!current) return
    const profileName = session.status === 'valid' ? session.profileName?.trim() || null : null
    accounts.update(session.accountId, {
      name: profileName ?? current.name,
      status: session.status === 'valid' || session.status === 'needs_login' ? session.status : current.status,
      cookie: session.status === 'valid' && session.cookie ? session.cookie : current.cookie,
      cookieStatus: session.cookieStatus,
      lastCookieCheck: session.lastCookieCheck,
      lastUsedAt: session.status === 'valid' ? Date.now() : current.lastUsedAt
    })
  }, () => appSettings.get().browser, () => appSettings.get().session)

  const corePosting = new PostingService(
    options.database,
    options.dataDirectory,
    () => appSettings.get().browser,
    () => appSettings.get().session,
    () => appSettings.get().network,
    () => appSettings.get().runtime,
    () => appSettings.get().logging
  )
  const posting = new ResilientPostingService(
    corePosting,
    options.database,
    executionLogs,
    () => appSettings.get().runtime,
    () => appSettings.get().logging
  )
  const accountExecution = new AccountExecutionCoordinator()
  const coordinatedPosting: RotationPostingExecutor = {
    executeSingle: (payload) => {
      const accountId = payload.accountId
      if (accountId === undefined) return posting.executeSingle(payload)
      return accountExecution.run(accountId, () => posting.executeSingle(payload))
    },
    releaseAccount: (accountId) => accountExecution.run(accountId, () => corePosting.releaseAccount(accountId))
  }
  const rotation = new PageTabWorkerManager(
    () => new RotationService(
      runs,
      coordinatedPosting,
      undefined,
      () => appSettings.get().session,
      () => appSettings.get().network,
      (pageTabId) => pageTabs.get(pageTabId)?.schedules ?? null
    ),
    () => appSettings.get().runtime.maxActivePageTabs
  )

  ipcMain.handle(IPC_CHANNELS.appInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    dataDirectory: options.dataDirectory
  }))

  ipcMain.handle(IPC_CHANNELS.accountsList, (_event, filters?: AccountListFilters) => accounts.list(filters))
  ipcMain.handle(IPC_CHANNELS.accountsCreate, (_event, input: AccountDraft) => accounts.create(input))
  ipcMain.handle(IPC_CHANNELS.accountsUpdate, (_event, payload: AccountUpdatePayload) => accounts.update(payload.id, payload.patch))
  ipcMain.handle(IPC_CHANNELS.accountsDelete, (_event, payload: AccountDeletePayload) => accounts.delete(payload.ids))
  ipcMain.handle(IPC_CHANNELS.accountsImport, (_event, request: AccountImportRequest) => accounts.import(request))
  ipcMain.handle(IPC_CHANNELS.accountPresetsList, () => accounts.listImportPresets())
  ipcMain.handle(IPC_CHANNELS.accountPresetsSave, (_event, input: SaveImportPresetInput) => accounts.saveImportPreset(input))
  ipcMain.handle(IPC_CHANNELS.accountPresetsDelete, (_event, id: number) => accounts.deleteImportPreset(id))
  ipcMain.handle(IPC_CHANNELS.accountColumnLayoutGet, () => accounts.getColumnLayout('accounts'))
  ipcMain.handle(IPC_CHANNELS.accountColumnLayoutSave, (_event, payload: AccountColumnLayoutPayload) => { accounts.saveColumnLayout('accounts', payload.layout) })
  ipcMain.handle(IPC_CHANNELS.accountOpenProfile, (_event, payload: AccountOpenProfilePayload) => {
    const account = accounts.getById(payload.accountId)
    if (!account) return { status: 'error', message: 'Account không tồn tại.' }
    return browserProfiles.open(account)
  })

  ipcMain.handle(IPC_CHANNELS.pageTabsList, () => pageTabs.list())
  ipcMain.handle(IPC_CHANNELS.pageTabsGet, (_event, payload: PageTabIdPayload) => pageTabs.get(payload.id))
  ipcMain.handle(IPC_CHANNELS.pageTabsCreate, (_event, input: CreatePageTabInput) => pageTabs.create(input))
  ipcMain.handle(IPC_CHANNELS.pageTabsUpdate, (_event, payload: UpdatePageTabPayload) => pageTabs.update(payload.id, payload.config))
  ipcMain.handle(IPC_CHANNELS.pageTabsDelete, (_event, payload: PageTabIdPayload) => pageTabs.delete(payload.id))
  ipcMain.handle(IPC_CHANNELS.pageTabsDuplicate, (_event, payload: PageTabIdPayload) => pageTabs.duplicate(payload.id))

  ipcMain.handle(IPC_CHANNELS.pageTabsPickImageFolder, async () => {
    const result = await dialog.showOpenDialog({ title: 'Chọn folder ảnh cho Page Tab', properties: ['openDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC_CHANNELS.pageTabsInspectImageFolder, async (_event, folderPath: string) => {
    const normalized = folderPath.trim()
    if (!normalized) return { exists: false, fileCount: 0 }
    try {
      const entries = await readdir(normalized, { withFileTypes: true })
      return {
        exists: true,
        fileCount: entries.filter((entry) => entry.isFile() && supportedImageExtensions.has(extname(entry.name).toLowerCase())).length
      }
    } catch {
      return { exists: false, fileCount: 0 }
    }
  })
  ipcMain.handle(IPC_CHANNELS.pageTabsPickTextFile, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import text / CSV',
      properties: ['openFile'],
      filters: [{ name: 'Text / CSV', extensions: ['txt', 'csv'] }, { name: 'All files', extensions: ['*'] }]
    })
    const filePath = result.canceled ? undefined : result.filePaths[0]
    if (!filePath) return null
    const fileStat = await stat(filePath)
    if (fileStat.size > 10 * 1024 * 1024) throw new Error('File import lớn hơn giới hạn 10 MB.')
    return { path: filePath, content: await readFile(filePath, 'utf8') }
  })

  ipcMain.handle(IPC_CHANNELS.runsLatestForPageTab, (_event, payload: CreateRunPayload) => runs.getLatestForPageTab(payload.pageTabId))
  ipcMain.handle(IPC_CHANNELS.runsCreate, (_event, payload: CreateRunPayload) => runs.createForPageTab(payload.pageTabId))
  ipcMain.handle(IPC_CHANNELS.runsPause, (_event, payload: RunIdPayload) => runs.pause(payload.runId))
  ipcMain.handle(IPC_CHANNELS.runsResume, (_event, payload: RunIdPayload) => runs.resume(payload.runId))
  ipcMain.handle(IPC_CHANNELS.postingExecuteSingle, (_event, payload: ExecuteSinglePostingJobPayload) => coordinatedPosting.executeSingle(payload))
  ipcMain.handle(IPC_CHANNELS.rotationList, () => rotation.list(pageTabs.list().map((tab) => tab.id)))
  ipcMain.handle(IPC_CHANNELS.rotationStatus, (_event, payload: RotationPageTabPayload) => rotation.status(payload))
  ipcMain.handle(IPC_CHANNELS.rotationStart, (_event, payload: RotationPageTabPayload) => rotation.start(payload))
  ipcMain.handle(IPC_CHANNELS.rotationPause, (_event, payload: RotationPageTabPayload) => rotation.pause(payload))
  ipcMain.handle(IPC_CHANNELS.rotationResume, (_event, payload: RotationPageTabPayload) => rotation.resume(payload))
  ipcMain.handle(IPC_CHANNELS.rotationStop, (_event, payload: RotationPageTabPayload) => rotation.stop(payload))

  ipcMain.handle(IPC_CHANNELS.executionLogsList, (_event, filters?: ExecutionLogFilters) => executionLogs.list(filters))
  ipcMain.handle(IPC_CHANNELS.executionLogsRetryItem, (_event, payload: RetryRunItemPayload) => recovery.retryFailedItem(payload.runItemId))
  ipcMain.handle(IPC_CHANNELS.executionLogsCleanup, () => logMaintenance.cleanup(appSettings.get().logging, { force: true }))

  ipcMain.handle(IPC_CHANNELS.appSettingsGet, () => appSettings.get())
  ipcMain.handle(IPC_CHANNELS.appSettingsUpdate, async (_event, input: AppSettingsPatch) => {
    const next = appSettings.update(input)
    if (input.logging) await logMaintenance.cleanup(next.logging).catch(() => undefined)
    return next
  })
  ipcMain.handle(IPC_CHANNELS.appSettingsReset, async () => {
    const next = appSettings.reset()
    await logMaintenance.cleanup(next.logging).catch(() => undefined)
    return next
  })

  ipcMain.handle(IPC_CHANNELS.browserDetect, () => browserEngine.detectChrome())
  ipcMain.handle(IPC_CHANNELS.browserProbeExecutable, (_event, executablePath: string) => browserEngine.probeExecutable(executablePath))
  ipcMain.handle(IPC_CHANNELS.browserPickExecutable, async () => {
    const result = await dialog.showOpenDialog({ title: 'Chọn Chrome', properties: ['openFile'], filters: [{ name: 'Chrome', extensions: ['exe'] }] })
    const executablePath = result.canceled ? undefined : result.filePaths[0]
    if (!executablePath) return { status: 'canceled', executablePath: null, version: null, message: 'Đã hủy chọn Chrome.' }
    return browserEngine.probeExecutable(executablePath)
  })
  ipcMain.handle(IPC_CHANNELS.browserTest, (_event, input: BrowserTestRequest) => {
    const current = appSettings.get()
    const candidate = { ...current, browser: { ...input.settings } }
    assertValidAppSettings(candidate)
    return browserEngine.testBrowser(candidate.browser)
  })

  ipcMain.handle(IPC_CHANNELS.captchaSettingsGet, () => captchaSettings.get())
  ipcMain.handle(IPC_CHANNELS.captchaSettingsSave, (_event, input: SaveCaptchaSettingsInput) => captchaSettings.save(input))

  ipcMain.handle(IPC_CHANNELS.configBackupExport, async () => {
    const backupDirectory = join(options.dataDirectory, 'backups')
    await mkdir(backupDirectory, { recursive: true })
    const defaultName = `PageAuto-config-v${app.getVersion()}-${new Date().toISOString().slice(0, 10)}.json`
    const result = await dialog.showSaveDialog({ title: 'Xuất PAGE-AUTO config backup', defaultPath: join(backupDirectory, defaultName), filters: [{ name: 'PAGE-AUTO config backup', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return { canceled: true, filePath: null, summary: null, message: 'Đã hủy xuất backup.' }
    const payload = configBackup.createPayload(app.getVersion())
    await mkdir(dirname(result.filePath), { recursive: true })
    await writeFile(result.filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    return { canceled: false, filePath: result.filePath, summary: configBackup.getSummary(payload), message: `Đã xuất backup cấu hình: ${result.filePath}` }
  })

  ipcMain.handle(IPC_CHANNELS.configBackupRestore, async (): Promise<ConfigBackupRestoreResult> => {
    const result = await dialog.showOpenDialog({ title: 'Khôi phục PAGE-AUTO config backup', properties: ['openFile'], filters: [{ name: 'PAGE-AUTO config backup', extensions: ['json'] }] })
    const filePath = result.canceled ? undefined : result.filePaths[0]
    if (!filePath) return { canceled: true, filePath: null, accountsCreated: 0, pageTabsCreated: 0, pageTabsUpdated: 0, importPresetsRestored: 0, columnLayoutRestored: false, message: 'Đã hủy restore backup.' }
    const fileStat = await stat(filePath)
    if (fileStat.size > MAX_BACKUP_FILE_BYTES) throw new Error('File backup lớn hơn giới hạn 20 MB.')
    return configBackup.restoreFromJson(await readFile(filePath, 'utf8'), filePath)
  })

  return {
    dispose: () => {
      rotation.dispose()
      corePosting.closeAll()
      browserProfiles.closeAll()
      browserEngine.closeAll()
    }
  }
}
