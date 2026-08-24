import type Database from 'better-sqlite3'
import { ACCOUNT_IMPORT_FIELDS, type AccountColumnLayout, type AccountImportMapping } from '../../shared/accounts'
import {
  CONFIG_BACKUP_FORMAT,
  CONFIG_BACKUP_VERSION,
  type ConfigBackupPageTab,
  type ConfigBackupPayload,
  type ConfigBackupRestoreResult,
  type ConfigBackupSummary
} from '../../shared/configBackup'
import { POST_SELECTION_MODES, type PageTabPostInput } from '../../shared/pageTabs'
import { AccountRepository } from '../database/accountRepository'
import { PageTabPostRepository } from '../database/pageTabPostRepository'
import { PageTabRepository } from '../database/pageTabRepository'

const SECRET_EXCLUDES = [
  'password',
  'cookie/session',
  '2FA secret',
  'email password',
  'proxy password',
  'browser profiles',
  'runtime logs/screenshots'
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isImportMapping(value: unknown): value is AccountImportMapping {
  if (!Array.isArray(value)) return false
  return value.every((item) => item === 'ignore' || (
    typeof item === 'string' && (ACCOUNT_IMPORT_FIELDS as readonly string[]).includes(item)
  ))
}

function isColumnLayout(value: unknown): value is AccountColumnLayout {
  if (!isRecord(value)) return false
  return Array.isArray(value.order)
    && value.order.every((item) => typeof item === 'string')
    && Array.isArray(value.hidden)
    && value.hidden.every((item) => typeof item === 'string')
    && isRecord(value.widths)
    && Object.values(value.widths).every((item) => typeof item === 'number' && Number.isFinite(item))
}

function isPostInput(value: unknown): value is PageTabPostInput {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.enabled !== 'boolean') return false
  if (typeof value.sortOrder !== 'number' || !Number.isInteger(value.sortOrder) || !Array.isArray(value.variants) || !value.variants.every((item) => typeof item === 'string')) return false
  if (!isRecord(value.image)) return false
  return typeof value.image.folderPath === 'string'
    && typeof value.image.mode === 'string'
    && typeof value.image.imagesPerPost === 'number'
    && typeof value.image.missingPolicy === 'string'
}

function validateOptionalPostLibrary(tab: Record<string, unknown>): void {
  if (tab.postLibrary === undefined) return
  if (!isRecord(tab.postLibrary)
    || typeof tab.postLibrary.mode !== 'string'
    || !POST_SELECTION_MODES.includes(tab.postLibrary.mode as (typeof POST_SELECTION_MODES)[number])
    || !Array.isArray(tab.postLibrary.posts)
    || !tab.postLibrary.posts.every(isPostInput)) {
    throw new Error('Post Library trong backup không hợp lệ.')
  }
}

function parseBackup(rawText: string): ConfigBackupPayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText) as unknown
  } catch {
    throw new Error('File backup không phải JSON hợp lệ.')
  }

  if (!isRecord(parsed) || parsed.format !== CONFIG_BACKUP_FORMAT || parsed.version !== CONFIG_BACKUP_VERSION) {
    throw new Error('File không đúng định dạng PAGE-AUTO config backup v1.')
  }
  if (!Array.isArray(parsed.accounts) || !Array.isArray(parsed.pageTabs) || !Array.isArray(parsed.importPresets)) {
    throw new Error('File backup thiếu dữ liệu cấu hình bắt buộc.')
  }
  if (parsed.accountColumnLayout !== null && !isColumnLayout(parsed.accountColumnLayout)) {
    throw new Error('Column layout trong backup không hợp lệ.')
  }

  for (const preset of parsed.importPresets) {
    if (!isRecord(preset) || typeof preset.name !== 'string' || typeof preset.delimiter !== 'string' || !isImportMapping(preset.mapping)) {
      throw new Error('Import preset trong backup không hợp lệ.')
    }
  }
  for (const tab of parsed.pageTabs) {
    if (isRecord(tab)) validateOptionalPostLibrary(tab)
  }

  return parsed as unknown as ConfigBackupPayload
}

function summary(payload: ConfigBackupPayload): ConfigBackupSummary {
  return {
    accounts: payload.accounts.length,
    pageTabs: payload.pageTabs.length,
    importPresets: payload.importPresets.length,
    hasColumnLayout: payload.accountColumnLayout !== null
  }
}

export class ConfigBackupService {
  private readonly accounts: AccountRepository
  private readonly pageTabs: PageTabRepository
  private readonly posts: PageTabPostRepository

  constructor(private readonly client: Database.Database) {
    this.accounts = new AccountRepository(client)
    this.pageTabs = new PageTabRepository(client)
    this.posts = new PageTabPostRepository(client)
  }

  createPayload(appVersion: string): ConfigBackupPayload {
    const accounts = this.accounts.list().map((account) => ({
      uid: account.uid,
      name: account.name,
      category: account.category
    }))

    const pageTabs = this.pageTabs.list().map((tabSummary): ConfigBackupPageTab => {
      const tab = this.pageTabs.get(tabSummary.id)
      if (!tab) throw new Error(`Không thể đọc Page Tab #${tabSummary.id} để backup.`)
      const postLibrary = this.posts.get(tab.id)
      return {
        name: tab.name,
        pageUid: tab.pageUid,
        rotation: { ...tab.rotation },
        accounts: tab.accounts.map((account) => ({
          uid: account.uid,
          enabled: account.enabled,
          sortOrder: account.sortOrder,
          postsPerTurn: account.postsPerTurn
        })),
        schedules: tab.schedules.map((schedule) => ({
          dayOfWeek: schedule.dayOfWeek,
          startMinute: schedule.startMinute,
          endMinute: schedule.endMinute,
          enabled: schedule.enabled,
          sortOrder: schedule.sortOrder
        })),
        groupUids: [...tab.groupUids],
        contentMode: tab.contentMode,
        contents: [...tab.contents],
        image: { ...tab.image },
        postLibrary: {
          mode: postLibrary.mode,
          posts: postLibrary.posts.map((post, index) => ({
            name: post.name,
            enabled: post.enabled,
            sortOrder: index,
            variants: [...post.variants],
            image: { ...post.image }
          }))
        }
      }
    })

    return {
      format: CONFIG_BACKUP_FORMAT,
      version: CONFIG_BACKUP_VERSION,
      appVersion,
      exportedAt: Date.now(),
      security: {
        containsSecrets: false,
        excludes: [...SECRET_EXCLUDES]
      },
      accounts,
      pageTabs,
      importPresets: this.accounts.listImportPresets().map((preset) => ({
        name: preset.name,
        delimiter: preset.delimiter,
        mapping: [...preset.mapping]
      })),
      accountColumnLayout: this.accounts.getColumnLayout('accounts')
    }
  }

  getSummary(payload: ConfigBackupPayload): ConfigBackupSummary {
    return summary(payload)
  }

  restoreFromJson(rawText: string, filePath: string | null = null): ConfigBackupRestoreResult {
    const payload = parseBackup(rawText)
    const activeRun = this.client.prepare(`
      SELECT id FROM runs
      WHERE status IN ('created', 'running', 'paused')
      ORDER BY id
      LIMIT 1
    `).get() as { id: number } | undefined
    if (activeRun) {
      throw new Error(`Đang có run #${activeRun.id} chưa kết thúc. Hãy dừng/hoàn tất run trước khi restore config.`)
    }

    let accountsCreated = 0
    let pageTabsCreated = 0
    let pageTabsUpdated = 0
    let importPresetsRestored = 0
    let columnLayoutRestored = false

    const restore = this.client.transaction(() => {
      const ensureAccount = (uidValue: string, name: string | null = null, category: string | null = null) => {
        const uid = uidValue.trim()
        if (!uid) throw new Error('Backup có account UID rỗng.')
        const existing = this.accounts.getByUid(uid)
        if (existing) return existing
        accountsCreated += 1
        return this.accounts.create({ uid, name, category, status: 'unknown' })
      }

      const seenAccountUids = new Set<string>()
      for (const rawAccount of payload.accounts) {
        if (!isRecord(rawAccount) || typeof rawAccount.uid !== 'string') {
          throw new Error('Account reference trong backup không hợp lệ.')
        }
        const uid = rawAccount.uid.trim()
        if (!uid || seenAccountUids.has(uid)) continue
        seenAccountUids.add(uid)
        ensureAccount(
          uid,
          typeof rawAccount.name === 'string' ? rawAccount.name : null,
          typeof rawAccount.category === 'string' ? rawAccount.category : null
        )
      }

      const knownTabs = this.pageTabs.list().map((item) => ({ id: item.id, name: item.name, pageUid: item.pageUid }))
      for (const rawTab of payload.pageTabs) {
        if (!isRecord(rawTab) || typeof rawTab.name !== 'string' || typeof rawTab.pageUid !== 'string') {
          throw new Error('Page Tab trong backup không hợp lệ.')
        }
        const tab = rawTab as unknown as ConfigBackupPageTab
        if (!Array.isArray(tab.accounts) || !Array.isArray(tab.schedules) || !Array.isArray(tab.groupUids) || !Array.isArray(tab.contents)) {
          throw new Error(`Page Tab "${tab.name}" thiếu cấu hình bắt buộc.`)
        }

        const restoredAccounts = tab.accounts.map((account, index) => {
          if (!account || typeof account.uid !== 'string') {
            throw new Error(`Page Tab "${tab.name}" có account reference không hợp lệ.`)
          }
          const record = ensureAccount(account.uid)
          return {
            accountId: record.id,
            enabled: account.enabled === true,
            sortOrder: index,
            postsPerTurn: account.postsPerTurn === null ? null : account.postsPerTurn
          }
        })

        const samePage = knownTabs.filter((item) => item.pageUid === tab.pageUid)
        const target = samePage.find((item) => item.name === tab.name) ?? (samePage.length === 1 ? samePage[0] : undefined)
        const created = target ? null : this.pageTabs.create({ name: tab.name, pageUid: tab.pageUid })
        const targetId = target?.id ?? created?.id
        if (!targetId) throw new Error(`Không thể xác định Page Tab đích cho "${tab.name}".`)
        if (target) pageTabsUpdated += 1
        else {
          pageTabsCreated += 1
          if (created) knownTabs.push({ id: created.id, name: created.name, pageUid: created.pageUid })
        }

        const updated = this.pageTabs.update(targetId, {
          name: tab.name,
          pageUid: tab.pageUid,
          rotation: { ...tab.rotation },
          accounts: restoredAccounts,
          schedules: tab.schedules.map((item, index) => ({
            dayOfWeek: item.dayOfWeek,
            startMinute: item.startMinute,
            endMinute: item.endMinute,
            enabled: item.enabled,
            sortOrder: index
          })),
          groupUids: [...tab.groupUids],
          contentMode: tab.contentMode,
          contents: [...tab.contents],
          image: { ...tab.image }
        })

        if (tab.postLibrary) {
          this.posts.save({
            pageTabId: targetId,
            mode: tab.postLibrary.mode,
            posts: tab.postLibrary.posts.map((post, index) => ({
              name: post.name,
              enabled: post.enabled,
              sortOrder: index,
              variants: [...post.variants],
              image: { ...post.image }
            }))
          })
        }

        const knownIndex = knownTabs.findIndex((item) => item.id === updated.id)
        if (knownIndex >= 0) knownTabs[knownIndex] = { id: updated.id, name: updated.name, pageUid: updated.pageUid }
      }

      for (const preset of payload.importPresets) {
        this.accounts.saveImportPreset({
          name: preset.name,
          delimiter: preset.delimiter,
          mapping: [...preset.mapping]
        })
        importPresetsRestored += 1
      }

      if (payload.accountColumnLayout) {
        this.accounts.saveColumnLayout('accounts', payload.accountColumnLayout)
        columnLayoutRestored = true
      }
    })

    restore()

    return {
      canceled: false,
      filePath,
      accountsCreated,
      pageTabsCreated,
      pageTabsUpdated,
      importPresetsRestored,
      columnLayoutRestored,
      message: `Đã restore ${pageTabsCreated + pageTabsUpdated} Page Tab; ${accountsCreated} account shell mới. Credential và browser profile không được import.`
    }
  }
}
