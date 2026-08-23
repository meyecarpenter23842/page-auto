import { app, dialog, ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import { readFile, readdir, stat } from 'node:fs/promises'
import { extname } from 'node:path'
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
import type {
  CreatePageTabInput,
  PageTabIdPayload,
  UpdatePageTabPayload
} from '../shared/pageTabs'
import type { ExecuteSinglePostingJobPayload } from '../shared/posting'
import type { RotationPageTabPayload } from '../shared/rotation'
import type { CreateRunPayload, RunIdPayload } from '../shared/runs'
import { BrowserProfileManager } from './browser/browserProfileManager'
import { AccountRepository } from './database/accountRepository'
import { PageTabRepository } from './database/pageTabRepository'
import { RunRepository } from './database/runRepository'
import { AccountExecutionCoordinator } from './services/accountExecutionCoordinator'
import { PageTabWorkerManager } from './services/pageTabWorkerManager'
import { PostingService } from './services/postingService'
import { RotationService, type RotationPostingExecutor } from './services/rotationService'

interface RegisterIpcOptions {
  database: Database.Database
  dataDirectory: string
}

export interface IpcRuntime {
  dispose: () => void
}

const supportedImageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp'])

export function registerIpcHandlers(options: RegisterIpcOptions): IpcRuntime {
  const accounts = new AccountRepository(options.database)
  const pageTabs = new PageTabRepository(options.database)
  const runs = new RunRepository(options.database)
  const browserProfiles = new BrowserProfileManager(options.dataDirectory)
  const posting = new PostingService(options.database, options.dataDirectory)
  const accountExecution = new AccountExecutionCoordinator()
  const coordinatedPosting: RotationPostingExecutor = {
    executeSingle: (payload) => {
      const accountId = payload.accountId
      if (accountId === undefined) return posting.executeSingle(payload)
      return accountExecution.run(accountId, () => posting.executeSingle(payload))
    }
  }
  const rotation = new PageTabWorkerManager(
    () => new RotationService(runs, coordinatedPosting)
  )

  ipcMain.handle(IPC_CHANNELS.appInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion()
  }))

  ipcMain.handle(IPC_CHANNELS.accountsList, (_event, filters?: AccountListFilters) => accounts.list(filters))
  ipcMain.handle(IPC_CHANNELS.accountsCreate, (_event, input: AccountDraft) => accounts.create(input))
  ipcMain.handle(IPC_CHANNELS.accountsUpdate, (_event, payload: AccountUpdatePayload) =>
    accounts.update(payload.id, payload.patch)
  )
  ipcMain.handle(IPC_CHANNELS.accountsDelete, (_event, payload: AccountDeletePayload) =>
    accounts.delete(payload.ids)
  )
  ipcMain.handle(IPC_CHANNELS.accountsImport, (_event, request: AccountImportRequest) => accounts.import(request))
  ipcMain.handle(IPC_CHANNELS.accountPresetsList, () => accounts.listImportPresets())
  ipcMain.handle(IPC_CHANNELS.accountPresetsSave, (_event, input: SaveImportPresetInput) =>
    accounts.saveImportPreset(input)
  )
  ipcMain.handle(IPC_CHANNELS.accountPresetsDelete, (_event, id: number) => accounts.deleteImportPreset(id))
  ipcMain.handle(IPC_CHANNELS.accountColumnLayoutGet, () => accounts.getColumnLayout('accounts'))
  ipcMain.handle(IPC_CHANNELS.accountColumnLayoutSave, (_event, payload: AccountColumnLayoutPayload) => {
    accounts.saveColumnLayout('accounts', payload.layout)
  })
  ipcMain.handle(IPC_CHANNELS.accountOpenProfile, (_event, payload: AccountOpenProfilePayload) => {
    if (!accounts.getById(payload.accountId)) {
      return { status: 'error', message: 'Account không tồn tại.' }
    }
    return browserProfiles.open(payload.accountId)
  })

  ipcMain.handle(IPC_CHANNELS.pageTabsList, () => pageTabs.list())
  ipcMain.handle(IPC_CHANNELS.pageTabsGet, (_event, payload: PageTabIdPayload) => pageTabs.get(payload.id))
  ipcMain.handle(IPC_CHANNELS.pageTabsCreate, (_event, input: CreatePageTabInput) => pageTabs.create(input))
  ipcMain.handle(IPC_CHANNELS.pageTabsUpdate, (_event, payload: UpdatePageTabPayload) =>
    pageTabs.update(payload.id, payload.config)
  )
  ipcMain.handle(IPC_CHANNELS.pageTabsDelete, (_event, payload: PageTabIdPayload) => pageTabs.delete(payload.id))
  ipcMain.handle(IPC_CHANNELS.pageTabsDuplicate, (_event, payload: PageTabIdPayload) => pageTabs.duplicate(payload.id))

  ipcMain.handle(IPC_CHANNELS.pageTabsPickImageFolder, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Chọn folder ảnh cho Page Tab',
      properties: ['openDirectory']
    })
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
      filters: [
        { name: 'Text / CSV', extensions: ['txt', 'csv'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    const filePath = result.canceled ? undefined : result.filePaths[0]
    if (!filePath) return null

    const fileStat = await stat(filePath)
    if (fileStat.size > 10 * 1024 * 1024) {
      throw new Error('File import lớn hơn giới hạn 10 MB.')
    }

    return {
      path: filePath,
      content: await readFile(filePath, 'utf8')
    }
  })

  ipcMain.handle(IPC_CHANNELS.runsLatestForPageTab, (_event, payload: CreateRunPayload) =>
    runs.getLatestForPageTab(payload.pageTabId)
  )
  ipcMain.handle(IPC_CHANNELS.runsCreate, (_event, payload: CreateRunPayload) =>
    runs.createForPageTab(payload.pageTabId)
  )
  ipcMain.handle(IPC_CHANNELS.runsPause, (_event, payload: RunIdPayload) => runs.pause(payload.runId))
  ipcMain.handle(IPC_CHANNELS.runsResume, (_event, payload: RunIdPayload) => runs.resume(payload.runId))
  ipcMain.handle(IPC_CHANNELS.postingExecuteSingle, (_event, payload: ExecuteSinglePostingJobPayload) =>
    posting.executeSingle(payload)
  )
  ipcMain.handle(IPC_CHANNELS.rotationList, () =>
    rotation.list(pageTabs.list().map((tab) => tab.id))
  )
  ipcMain.handle(IPC_CHANNELS.rotationStatus, (_event, payload: RotationPageTabPayload) =>
    rotation.status(payload)
  )
  ipcMain.handle(IPC_CHANNELS.rotationStart, (_event, payload: RotationPageTabPayload) =>
    rotation.start(payload)
  )
  ipcMain.handle(IPC_CHANNELS.rotationPause, (_event, payload: RotationPageTabPayload) =>
    rotation.pause(payload)
  )
  ipcMain.handle(IPC_CHANNELS.rotationResume, (_event, payload: RotationPageTabPayload) =>
    rotation.resume(payload)
  )

  return {
    dispose: () => {
      rotation.dispose()
      posting.closeAll()
      browserProfiles.closeAll()
    }
  }
}
