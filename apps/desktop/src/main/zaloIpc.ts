import { existsSync, statSync } from 'node:fs'
import { basename, isAbsolute } from 'node:path'
import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import {
  maskZaloPassword,
  normalizeZaloActionInput,
  normalizeZaloBatchStartPayload,
  ZALO_IPC,
  type SaveZaloPostLibraryInput,
  type ZaloAccountDraft,
  type ZaloAccountIdPayload,
  type ZaloAccountRecord,
  type ZaloAccountUpdatePayload,
  type ZaloAccountView,
  type ZaloActionInput,
  type ZaloActionRequestPayload,
  type ZaloBatchRunIdPayload,
  type ZaloBatchStartPayload,
  type ZaloBrowserSettings,
  type ZaloLoginPayload
} from '../shared/zalo'
import { ZaloAccountRepository } from './database/zaloRepository'
import { ZaloPostRepository } from './database/zaloPostRepository'
import { ZaloSettingsRepository } from './database/zaloSettingsRepository'
import { ZaloBatchRunner } from './zalo/zaloBatchRunner'
import { ZaloBrowserRuntime } from './zalo/zaloBrowserRuntime'

export interface ZaloIpcRuntime { dispose: () => void }

function toView(account: ZaloAccountRecord): ZaloAccountView {
  return {
    id: account.id,
    phone: account.phone,
    displayName: account.displayName,
    status: account.status,
    sessionStatus: account.sessionStatus,
    note: account.note,
    hasPassword: Boolean(account.password),
    passwordMasked: maskZaloPassword(account.password),
    lastOpenedAt: account.lastOpenedAt,
    lastLoginAt: account.lastLoginAt,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  }
}

function validateAttachmentPaths(paths: readonly string[]): void {
  for (const path of paths) {
    if (!isAbsolute(path)) throw new Error('Attachment Zalo phải là đường dẫn tuyệt đối: ' + (basename(path) || 'file') + '.')
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error('Không tìm thấy attachment Zalo: ' + (basename(path) || 'file') + '.')
  }
}

function validateActionFiles(action: ZaloActionInput): ZaloActionInput {
  if (action.type !== 'send_attachment') return action
  validateAttachmentPaths(action.paths)
  return action
}

export function registerZaloIpc(client: Database.Database, dataDirectory: string): ZaloIpcRuntime {
  const accounts = new ZaloAccountRepository(client)
  const settings = new ZaloSettingsRepository(client)
  const posts = new ZaloPostRepository(client)
  const browser = new ZaloBrowserRuntime(dataDirectory, accounts, () => settings.get())
  const batch = new ZaloBatchRunner(accounts, browser)

  const handlers = [
    ZALO_IPC.list,
    ZALO_IPC.create,
    ZALO_IPC.update,
    ZALO_IPC.delete,
    ZALO_IPC.open,
    ZALO_IPC.login,
    ZALO_IPC.close,
    ZALO_IPC.actionExecute,
    ZALO_IPC.actionPause,
    ZALO_IPC.actionResume,
    ZALO_IPC.actionStop,
    ZALO_IPC.batchStart,
    ZALO_IPC.batchStatus,
    ZALO_IPC.batchPause,
    ZALO_IPC.batchResume,
    ZALO_IPC.batchStop,
    ZALO_IPC.postLibraryGet,
    ZALO_IPC.postLibrarySave,
    ZALO_IPC.settingsGet,
    ZALO_IPC.settingsSave
  ]
  for (const channel of handlers) ipcMain.removeHandler(channel)

  ipcMain.handle(ZALO_IPC.list, () => accounts.list().map(toView))
  ipcMain.handle(ZALO_IPC.create, (_event, input: ZaloAccountDraft) => toView(accounts.create(input)))
  ipcMain.handle(ZALO_IPC.update, (_event, payload: ZaloAccountUpdatePayload) => toView(accounts.update(payload)))
  ipcMain.handle(ZALO_IPC.delete, async (_event, payload: ZaloAccountIdPayload) => {
    await browser.close(payload.id)
    return accounts.delete(payload.id)
  })
  ipcMain.handle(ZALO_IPC.open, async (_event, payload: ZaloAccountIdPayload) => {
    const account = accounts.get(payload.id)
    if (!account) throw new Error('Không tìm thấy Zalo account #' + payload.id + '.')
    return browser.open(account)
  })
  ipcMain.handle(ZALO_IPC.login, async (_event, payload: ZaloLoginPayload) => {
    const account = accounts.get(payload.id)
    if (!account) throw new Error('Không tìm thấy Zalo account #' + payload.id + '.')
    return browser.login(account, payload.mode)
  })
  ipcMain.handle(ZALO_IPC.actionExecute, async (_event, payload: ZaloActionRequestPayload) => {
    const account = accounts.get(payload.id)
    if (!account) throw new Error('Không tìm thấy Zalo account #' + payload.id + '.')
    const action = validateActionFiles(normalizeZaloActionInput(payload.action))
    return browser.executeAction(account, action)
  })
  ipcMain.handle(ZALO_IPC.actionPause, (_event, payload: ZaloAccountIdPayload) => browser.controlAction(payload.id, 'pause'))
  ipcMain.handle(ZALO_IPC.actionResume, (_event, payload: ZaloAccountIdPayload) => browser.controlAction(payload.id, 'resume'))
  ipcMain.handle(ZALO_IPC.actionStop, (_event, payload: ZaloAccountIdPayload) => browser.controlAction(payload.id, 'stop'))
  ipcMain.handle(ZALO_IPC.batchStart, (_event, input: ZaloBatchStartPayload) => batch.start(normalizeZaloBatchStartPayload(input)))
  ipcMain.handle(ZALO_IPC.batchStatus, (_event, payload: ZaloBatchRunIdPayload) => batch.status(payload.runId))
  ipcMain.handle(ZALO_IPC.batchPause, (_event, payload: ZaloBatchRunIdPayload) => batch.pause(payload.runId))
  ipcMain.handle(ZALO_IPC.batchResume, (_event, payload: ZaloBatchRunIdPayload) => batch.resume(payload.runId))
  ipcMain.handle(ZALO_IPC.batchStop, (_event, payload: ZaloBatchRunIdPayload) => batch.stop(payload.runId))
  ipcMain.handle(ZALO_IPC.postLibraryGet, () => posts.get())
  ipcMain.handle(ZALO_IPC.postLibrarySave, (_event, input: SaveZaloPostLibraryInput) => posts.save(input))
  ipcMain.handle(ZALO_IPC.close, async (_event, payload: ZaloAccountIdPayload) => {
    await browser.close(payload.id)
    return true
  })
  ipcMain.handle(ZALO_IPC.settingsGet, () => settings.get())
  ipcMain.handle(ZALO_IPC.settingsSave, (_event, input: ZaloBrowserSettings) => {
    const saved = settings.save(input)
    browser.applySettingsToOpenBrowsers(saved)
    return saved
  })

  return {
    dispose: () => {
      batch.dispose()
      browser.closeAll()
      for (const channel of handlers) ipcMain.removeHandler(channel)
    }
  }
}
