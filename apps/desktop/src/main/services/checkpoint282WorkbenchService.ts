import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AccountRecord } from '../../shared/accounts'
import {
  assertValidFacebookCheckpoint282Preset,
  type FacebookCheckpoint282AccountPreflight,
  type FacebookCheckpoint282AssetPreview,
  type FacebookCheckpoint282AssetPreviewRequest,
  type FacebookCheckpoint282HistoryEntry,
  type FacebookCheckpoint282HistoryRequest,
  type FacebookCheckpoint282PreflightLevel,
  type FacebookCheckpoint282PreflightRequest,
  type FacebookCheckpoint282PreflightResult,
  type FacebookCheckpoint282Preset,
  type FacebookCheckpoint282ResolveDuplicateRequest,
  type FacebookCheckpoint282ResolveDuplicateResult
} from '../../shared/checkpoint282Workbench'
import { accountProfileDirectory } from '../browser/browserProfileManager'
import {
  appendCheckpoint282History,
  checkpoint282CanonicalFolder,
  inspectCheckpoint282ImageReadiness,
  readCheckpoint282AssetPreview,
  readCheckpoint282History,
  resolveCheckpoint282CanonicalConflict
} from '../browser/checkpoint282Assets'
import { resolveAccountProxyState } from '../browser/proxyConfig'
import { AccountRepository } from '../database/accountRepository'
import { Checkpoint282PresetRepository } from '../database/checkpoint282PresetRepository'

function maxLevel(...levels: FacebookCheckpoint282PreflightLevel[]): FacebookCheckpoint282PreflightLevel {
  if (levels.includes('blocked')) return 'blocked'
  if (levels.includes('warning')) return 'warning'
  return 'ok'
}

function accountRow(
  account: AccountRecord,
  dataDirectory: string,
  preset: FacebookCheckpoint282Preset
): FacebookCheckpoint282AccountPreflight {
  const profileExists = existsSync(accountProfileDirectory(dataDirectory, account.id))
  const hasCookie = Boolean(account.cookie?.trim())
  const hasPasswordFallback = Boolean(account.password?.trim())
  const hasTwoFactor = Boolean(account.twoFactorSecret?.trim())
  const proxyResolution = resolveAccountProxyState(account)
  const proxy = proxyResolution.status === 'invalid'
    ? 'invalid' as const
    : proxyResolution.status === 'valid'
      ? 'valid' as const
      : 'none' as const
  const image = inspectCheckpoint282ImageReadiness({
    dataDirectory,
    uid: account.uid,
    sourceImageFolder: preset.sourceImageFolder
  })

  const messages: string[] = []
  let sessionLevel: FacebookCheckpoint282PreflightLevel = 'ok'
  if (!profileExists && !hasCookie && account.status !== 'valid') {
    if (hasPasswordFallback) {
      sessionLevel = 'warning'
      messages.push('Không có session/cookie sẵn; Login Common sẽ cần password fallback.')
    } else {
      sessionLevel = 'blocked'
      messages.push('Không có profile/session/cookie hoặc password fallback để đăng nhập.')
    }
  } else if (account.status === 'needs_login') {
    sessionLevel = hasPasswordFallback ? 'warning' : 'blocked'
    messages.push(hasPasswordFallback
      ? 'Account đang cần login; có password fallback.'
      : 'Account đang cần login nhưng không có password fallback.')
  }

  const proxyLevel: FacebookCheckpoint282PreflightLevel = proxy === 'invalid' ? 'blocked' : 'ok'
  if (proxyResolution.status === 'invalid') messages.push(proxyResolution.message)

  let imageLevel: FacebookCheckpoint282PreflightLevel = 'ok'
  if (image.state === 'source') {
    imageLevel = 'warning'
    messages.push(`Chưa có ảnh canonical theo UID; có ${image.sourceCandidateCount} ảnh nguồn. U3 yêu cầu chọn đúng ảnh cho account trước khi Start.`)
  } else if (image.state === 'missing') {
    imageLevel = 'blocked'
    messages.push('Chưa có ảnh canonical và Folder ảnh nguồn không có ảnh hợp lệ.')
  } else if (image.state === 'duplicate') {
    imageLevel = 'blocked'
    messages.push(`Có ${image.canonicalCandidateCount} ảnh canonical trùng UID; cần chọn ảnh giữ lại trước khi chạy.`)
  }

  return {
    accountId: account.id,
    uid: account.uid,
    level: maxLevel(sessionLevel, proxyLevel, imageLevel),
    session: { profileExists, hasCookie, hasPasswordFallback, hasTwoFactor },
    browser: { proxy },
    image,
    messages
  }
}

function assertAccount(accounts: AccountRepository, accountId: number): AccountRecord {
  const account = accounts.getById(accountId)
  if (!account) throw new Error('Account không tồn tại.')
  return account
}

export class Checkpoint282WorkbenchService {
  private readonly accounts: AccountRepository
  private readonly presets: Checkpoint282PresetRepository

  constructor(
    database: Database.Database,
    private readonly dataDirectory: string
  ) {
    this.accounts = new AccountRepository(database)
    this.presets = new Checkpoint282PresetRepository(database)
  }

  getPreset(): FacebookCheckpoint282Preset {
    return this.presets.get()
  }

  savePreset(input: FacebookCheckpoint282Preset): FacebookCheckpoint282Preset {
    return this.presets.save(input)
  }

  preflight(input: FacebookCheckpoint282PreflightRequest): FacebookCheckpoint282PreflightResult {
    const preset = input.preset ?? this.presets.get()
    assertValidFacebookCheckpoint282Preset(preset)
    const seen = new Set<number>()
    const rows: FacebookCheckpoint282AccountPreflight[] = []

    for (const accountId of input.accountIds) {
      if (!Number.isInteger(accountId) || accountId <= 0 || seen.has(accountId)) continue
      seen.add(accountId)
      const account = this.accounts.getById(accountId)
      if (!account) {
        rows.push({
          accountId,
          uid: '',
          level: 'blocked',
          session: { profileExists: false, hasCookie: false, hasPasswordFallback: false, hasTwoFactor: false },
          browser: { proxy: 'none' },
          image: {
            state: 'missing',
            canonicalFolder: checkpoint282CanonicalFolder(this.dataDirectory),
            canonicalPath: null,
            canonicalCandidateCount: 0,
            canonicalCandidates: [],
            sourceFolder: preset.sourceImageFolder,
            sourceCandidateCount: 0,
            sourceCandidates: []
          },
          messages: ['Account không tồn tại.']
        })
        continue
      }
      rows.push(accountRow(account, this.dataDirectory, preset))
    }

    return {
      preset: { ...preset },
      canonicalFolder: checkpoint282CanonicalFolder(this.dataDirectory),
      rows,
      summary: {
        ok: rows.filter((row) => row.level === 'ok').length,
        warning: rows.filter((row) => row.level === 'warning').length,
        blocked: rows.filter((row) => row.level === 'blocked').length
      }
    }
  }

  previewAsset(input: FacebookCheckpoint282AssetPreviewRequest): FacebookCheckpoint282AssetPreview {
    const account = assertAccount(this.accounts, input.accountId)
    const preset = input.preset ?? this.presets.get()
    assertValidFacebookCheckpoint282Preset(preset)
    const image = inspectCheckpoint282ImageReadiness({
      dataDirectory: this.dataDirectory,
      uid: account.uid,
      sourceImageFolder: preset.sourceImageFolder
    })
    const allowed = [...image.canonicalCandidates, ...image.sourceCandidates]
    if (!allowed.includes(input.path)) throw new Error('Ảnh preview không còn thuộc Folder282/Folder ảnh nguồn của account hiện tại.')
    return readCheckpoint282AssetPreview(input.path)
  }

  resolveDuplicate(input: FacebookCheckpoint282ResolveDuplicateRequest): FacebookCheckpoint282ResolveDuplicateResult {
    const account = assertAccount(this.accounts, input.accountId)
    const resolved = resolveCheckpoint282CanonicalConflict({
      dataDirectory: this.dataDirectory,
      uid: account.uid,
      keepPath: input.keepPath
    })
    const message = `Đã giữ ${resolved.canonicalPath} và lưu ${resolved.archivedPaths.length} ảnh trùng vào archive.`
    appendCheckpoint282History(this.dataDirectory, {
      id: randomUUID(),
      at: Date.now(),
      accountId: account.id,
      uid: account.uid,
      action: 'resolve_duplicate',
      state: 'asset_conflict_resolved',
      message,
      assetPath: resolved.canonicalPath,
      assetOrigin: 'canonical',
      assetConfirmedUsed: false,
      promotionState: null,
      canonicalPath: resolved.canonicalPath,
      evidencePath: null
    })
    return {
      accountId: account.id,
      uid: account.uid,
      canonicalPath: resolved.canonicalPath,
      archivedPaths: resolved.archivedPaths,
      message
    }
  }

  history(input: FacebookCheckpoint282HistoryRequest): FacebookCheckpoint282HistoryEntry[] {
    const account = assertAccount(this.accounts, input.accountId)
    return readCheckpoint282History(this.dataDirectory, account.uid, input.limit ?? 50)
      .filter((entry) => entry.accountId === account.id)
  }
}
