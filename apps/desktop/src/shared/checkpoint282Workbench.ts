import type {
  FacebookCheckpoint282Action,
  FacebookCheckpoint282AssetOrigin,
  FacebookCheckpoint282AssetPromotionState,
  FacebookCheckpoint282State,
  FacebookCheckpointSurface
} from './facebookCheckpoint'
import type { HotmailMailStatus, HotmailOAuthStatus } from './hotmail'

export const FACEBOOK_CHECKPOINT282_PRESET_STORAGE_KEY = 'facebook.checkpoint282.preset'
export const FACEBOOK_CHECKPOINT282_LOCALES = ['auto', 'vi-VN', 'en-US'] as const
export type FacebookCheckpoint282Locale = (typeof FACEBOOK_CHECKPOINT282_LOCALES)[number]

export const CHECKPOINT282_WORKBENCH_IPC = {
  getPreset: 'facebook:checkpoint-282:preset:get',
  savePreset: 'facebook:checkpoint-282:preset:save',
  pickSourceFolder: 'facebook:checkpoint-282:source-folder:pick',
  preflight: 'facebook:checkpoint-282:preflight',
  previewAsset: 'facebook:checkpoint-282:asset:preview',
  resolveDuplicate: 'facebook:checkpoint-282:asset:resolve-duplicate',
  history: 'facebook:checkpoint-282:history',
  revealPath: 'facebook:checkpoint-282:path:reveal'
} as const

export interface FacebookCheckpoint282Preset {
  surface: FacebookCheckpointSurface
  locale: FacebookCheckpoint282Locale
  sourceImageFolder: string | null
}

export const DEFAULT_FACEBOOK_CHECKPOINT282_PRESET: Readonly<FacebookCheckpoint282Preset> = {
  surface: 'mbasic',
  locale: 'auto',
  sourceImageFolder: null
}

export type FacebookCheckpoint282PreflightLevel = 'ok' | 'warning' | 'blocked'
export type FacebookCheckpoint282ImageReadiness = 'canonical' | 'source' | 'missing' | 'duplicate'
export type FacebookCheckpoint282ProxyReadiness = 'none' | 'valid' | 'invalid'
export type FacebookCheckpoint282EmailReadiness =
  | 'ready'
  | 'missing_email'
  | 'oauth_missing'
  | 'oauth_pending'
  | 'oauth_expired'
  | 'oauth_error'
export type FacebookCheckpoint282PhoneReadiness = 'available' | 'missing'

export interface FacebookCheckpoint282PreflightRequest {
  accountIds: number[]
  preset?: FacebookCheckpoint282Preset
}

export interface FacebookCheckpoint282ImagePreflight {
  state: FacebookCheckpoint282ImageReadiness
  canonicalFolder: string
  canonicalPath: string | null
  canonicalCandidateCount: number
  canonicalCandidates: string[]
  sourceFolder: string | null
  sourceCandidateCount: number
  sourceCandidates: string[]
}

export interface FacebookCheckpoint282VerificationPreflight {
  email: {
    state: FacebookCheckpoint282EmailReadiness
    maskedAddress: string | null
    oauthStatus: HotmailOAuthStatus
    mailStatus: HotmailMailStatus
    hasClientId: boolean
    hasRefreshToken: boolean
    route: 'facebook_common_email_code'
    message: string
  }
  phone: {
    state: FacebookCheckpoint282PhoneReadiness
    maskedNumber: string | null
    route: 'classifier_required'
    message: string
  }
}

export interface FacebookCheckpoint282AccountPreflight {
  accountId: number
  uid: string
  level: FacebookCheckpoint282PreflightLevel
  session: {
    profileExists: boolean
    hasCookie: boolean
    hasPasswordFallback: boolean
    hasTwoFactor: boolean
  }
  browser: {
    proxy: FacebookCheckpoint282ProxyReadiness
  }
  image: FacebookCheckpoint282ImagePreflight
  verification: FacebookCheckpoint282VerificationPreflight
  messages: string[]
}

export interface FacebookCheckpoint282PreflightResult {
  preset: FacebookCheckpoint282Preset
  canonicalFolder: string
  rows: FacebookCheckpoint282AccountPreflight[]
  summary: {
    ok: number
    warning: number
    blocked: number
  }
}

export interface FacebookCheckpoint282AssetPreviewRequest {
  accountId: number
  path: string
  preset?: FacebookCheckpoint282Preset
}

export interface FacebookCheckpoint282AssetPreview {
  path: string
  fileName: string
  mimeType: 'image/jpeg' | 'image/png'
  dataUrl: string
  bytes: number
}

export interface FacebookCheckpoint282ResolveDuplicateRequest {
  accountId: number
  keepPath: string
}

export interface FacebookCheckpoint282ResolveDuplicateResult {
  accountId: number
  uid: string
  canonicalPath: string
  archivedPaths: string[]
  message: string
}

export interface FacebookCheckpoint282HistoryRequest {
  accountId: number
  limit?: number
}

export type FacebookCheckpoint282HistoryState = FacebookCheckpoint282State | 'asset_conflict_resolved'
export type FacebookCheckpoint282HistoryAction = FacebookCheckpoint282Action | 'resolve_duplicate'

export interface FacebookCheckpoint282HistoryEntry {
  id: string
  at: number
  accountId: number
  uid: string
  action: FacebookCheckpoint282HistoryAction
  state: FacebookCheckpoint282HistoryState
  message: string
  assetPath?: string | null
  assetOrigin?: FacebookCheckpoint282AssetOrigin | null
  assetConfirmedUsed?: boolean
  promotionState?: FacebookCheckpoint282AssetPromotionState | null
  canonicalPath?: string | null
  evidencePath?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function assertValidFacebookCheckpoint282Preset(value: unknown): asserts value is FacebookCheckpoint282Preset {
  if (!isRecord(value)) throw new Error('Preset CP282 phải là object.')
  if (!['mbasic', 'mobile', 'desktop'].includes(String(value.surface))) {
    throw new Error('Preset CP282 có browser surface không hợp lệ.')
  }
  if (!FACEBOOK_CHECKPOINT282_LOCALES.includes(value.locale as FacebookCheckpoint282Locale)) {
    throw new Error('Preset CP282 có locale không hợp lệ.')
  }
  if (value.sourceImageFolder !== null && (typeof value.sourceImageFolder !== 'string' || value.sourceImageFolder.length > 2048)) {
    throw new Error('Folder ảnh nguồn CP282 không hợp lệ.')
  }
}

export function parseFacebookCheckpoint282Preset(raw: string | undefined): FacebookCheckpoint282Preset {
  if (!raw) return { ...DEFAULT_FACEBOOK_CHECKPOINT282_PRESET }
  try {
    const parsed = JSON.parse(raw) as unknown
    assertValidFacebookCheckpoint282Preset(parsed)
    return {
      surface: parsed.surface,
      locale: parsed.locale,
      sourceImageFolder: parsed.sourceImageFolder?.trim() || null
    }
  } catch {
    return { ...DEFAULT_FACEBOOK_CHECKPOINT282_PRESET }
  }
}
