import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AccountRecord } from '../../shared/accounts'
import {
  assertValidFacebookCheckpoint282Preset,
  type FacebookCheckpoint282AccountPreflight,
  type FacebookCheckpoint282AssetPreview,
  type FacebookCheckpoint282AssetPreviewRequest,
  type FacebookCheckpoint282EmailReadiness,
  type FacebookCheckpoint282HistoryEntry,
  type FacebookCheckpoint282HistoryRequest,
  type FacebookCheckpoint282PreflightLevel,
  type FacebookCheckpoint282PreflightRequest,
  type FacebookCheckpoint282PreflightResult,
  type FacebookCheckpoint282Preset,
  type FacebookCheckpoint282ResolveDuplicateRequest,
  type FacebookCheckpoint282ResolveDuplicateResult,
  type FacebookCheckpoint282VerificationPreflight
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
import { HotmailRepository, type EmailStateRecord } from '../database/hotmailRepository'

function maxLevel(...levels: FacebookCheckpoint282PreflightLevel[]): FacebookCheckpoint282PreflightLevel {
  if (levels.includes('blocked')) return 'blocked'
  if (levels.includes('warning')) return 'warning'
  return 'ok'
}

function maskEmail(value: string | null): string | null {
  const normalized = value?.trim() ?? ''
  if (!normalized) return null
  const at = normalized.lastIndexOf('@')
  if (at <= 0 || at === normalized.length - 1) return '••••'
  const local = normalized.slice(0, at)
  const domain = normalized.slice(at + 1)
  const visible = local.slice(0, Math.min(2, local.length))
  return `${visible}${'•'.repeat(Math.max(3, Math.min(8, local.length - visible.length)))}@${domain}`
}

function maskPhone(value: string | null): string | null {
  const normalized = value?.trim().replace(/\s+/g, '') ?? ''
  if (!normalized) return null
  if (normalized.length <= 3) return '•••'
  return `${'•'.repeat(Math.max(4, Math.min(9, normalized.length - 3)))}${normalized.slice(-3)}`
}

function emailReadinessState(
  hasEmail: boolean,
  emailState: EmailStateRecord | null,
  hasClientId: boolean,
  hasRefreshToken: boolean
): FacebookCheckpoint282EmailReadiness {
  if (!hasEmail) return 'missing_email'
  if (!hasClientId || !hasRefreshToken || !emailState || emailState.oauthStatus === 'missing') return 'oauth_missing'
  if (emailState.oauthStatus === 'pending') return 'oauth_pending'
  if (emailState.oauthStatus === 'expired' || emailState.mailStatus === 'needs_login') return 'oauth_expired'
  if (emailState.oauthStatus === 'error' || emailState.mailStatus === 'error') return 'oauth_error'
  return emailState.oauthStatus === 'valid' ? 'ready' : 'oauth_missing'
}

function verificationPreflight(account: AccountRecord, emailState: EmailStateRecord | null): FacebookCheckpoint282VerificationPreflight {
  const hasEmail = Boolean(account.email?.trim())
  const hasClientId = Boolean(emailState?.oauthClientId?.trim())
  const hasRefreshToken = Boolean(emailState?.refreshTokenCiphertext)
  const emailStateName = emailReadinessState(hasEmail, emailState, hasClientId, hasRefreshToken)
  const emailMessages: Record<FacebookCheckpoint282EmailReadiness, string> = {
    ready: 'Email + OAuth canonical sẵn sàng. Nếu Facebook chọn Email challenge, mã phải đi qua Facebook Common / EmailCodeProvider.',
    missing_email: 'Account chưa có Email canonical. CP282 vẫn có thể chạy; chỉ Email challenge sẽ không có nguồn mã tự động.',
    oauth_missing: 'Có Email nhưng chưa đủ Client ID + Refresh Token canonical. Email challenge phải chuyển sang Common/coordinator #97.',
    oauth_pending: 'Email OAuth đang chờ hoàn tất. Không dùng mailbox nhập tay trong CP282 Workbench.',
    oauth_expired: 'Email OAuth cần khôi phục. Nếu gặp Email challenge, Common/coordinator #97 quyết định recovery/needs_attention.',
    oauth_error: 'Email OAuth/Mail đang lỗi. CP282 Workbench chỉ báo readiness, không tự vá Email flow.'
  }
  const phoneAvailable = Boolean(account.phone?.trim())

  return {
    email: {
      state: emailStateName,
      maskedAddress: maskEmail(account.email),
      oauthStatus: emailState?.oauthStatus ?? 'missing',
      mailStatus: emailState?.mailStatus ?? 'unknown',
      hasClientId,
      hasRefreshToken,
      route: 'facebook_common_email_code',
      message: emailMessages[emailStateName]
    },
    phone: {
      state: phoneAvailable ? 'available' : 'missing',
      maskedNumber: maskPhone(account.phone),
      route: 'classifier_required',
      message: phoneAvailable
        ? 'Có phone canonical, nhưng chỉ được coi là usable khi Facebook Common classifier xác nhận đúng route được hỗ trợ.'
        : 'Không có phone canonical. Phone không phải điều kiện chặn CP282 nếu current route không yêu cầu.'
    }
  }
}

function missingVerificationPreflight(): FacebookCheckpoint282VerificationPreflight {
  return {
    email: {
      state: 'missing_email',
      maskedAddress: null,
      oauthStatus: 'missing',
      mailStatus: 'unknown',
      hasClientId: false,
      hasRefreshToken: false,
      route: 'facebook_common_email_code',
      message: 'Account không tồn tại nên không có Email/OAuth canonical.'
    },
    phone: {
      state: 'missing',
      maskedNumber: null,
      route: 'classifier_required',
      message: 'Account không tồn tại nên không có phone canonical.'
    }
  }
}

function accountRow(
  account: AccountRecord,
  dataDirectory: string,
  preset: FacebookCheckpoint282Preset,
  emailState: EmailStateRecord | null
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
  const verification = verificationPreflight(account, emailState)

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
    verification,
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
  private readonly emailStates: HotmailRepository

  constructor(
    database: Database.Database,
    private readonly dataDirectory: string
  ) {
    this.accounts = new AccountRepository(database)
    this.presets = new Checkpoint282PresetRepository(database)
    this.emailStates = new HotmailRepository(database)
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
          verification: missingVerificationPreflight(),
          messages: ['Account không tồn tại.']
        })
        continue
      }
      rows.push(accountRow(account, this.dataDirectory, preset, this.emailStates.getEmailState(accountId)))
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
