import type { BrowserWindowLayoutSettings } from './browserWindowLayout'

export const ZALO_IPC = {
  list: 'zalo:accounts:list',
  create: 'zalo:accounts:create',
  update: 'zalo:accounts:update',
  delete: 'zalo:accounts:delete',
  open: 'zalo:accounts:open',
  login: 'zalo:accounts:login',
  close: 'zalo:accounts:close',
  settingsGet: 'zalo:settings:get',
  settingsSave: 'zalo:settings:save'
} as const

export const ZALO_SESSION_STATUSES = [
  'unknown',
  'ready',
  'login_required',
  'qr_waiting',
  'needs_attention',
  'browser_error',
  'profile_error'
] as const
export type ZaloSessionStatus = (typeof ZALO_SESSION_STATUSES)[number]

export const ZALO_LOGIN_MODES = ['phone_password', 'qr'] as const
export type ZaloLoginMode = (typeof ZALO_LOGIN_MODES)[number]

export interface ZaloAccountRecord {
  id: number
  phone: string
  password: string | null
  displayName: string | null
  status: string
  sessionStatus: ZaloSessionStatus
  note: string | null
  lastOpenedAt: number | null
  lastLoginAt: number | null
  createdAt: number
  updatedAt: number
}

export interface ZaloAccountView {
  id: number
  phone: string
  displayName: string | null
  status: string
  sessionStatus: ZaloSessionStatus
  note: string | null
  hasPassword: boolean
  passwordMasked: string
  lastOpenedAt: number | null
  lastLoginAt: number | null
  createdAt: number
  updatedAt: number
}

export interface ZaloAccountDraft {
  phone: string
  password?: string | null
  displayName?: string | null
  status?: string
  note?: string | null
}

export interface ZaloAccountUpdatePayload {
  id: number
  patch: Partial<ZaloAccountDraft>
}

export interface ZaloAccountIdPayload { id: number }

export interface ZaloLoginPayload {
  id: number
  mode: ZaloLoginMode
}

export interface ZaloBrowserSettings {
  executablePath: string | null
  profileRoot: string | null
  windowWidth: number
  windowHeight: number
  layout: BrowserWindowLayoutSettings
}

export interface ZaloOpenResult {
  accountId: number
  profileDirectory: string | null
  status: ZaloSessionStatus
  reused: boolean
  message: string
}

export const DEFAULT_ZALO_BROWSER_SETTINGS: Readonly<ZaloBrowserSettings> = {
  executablePath: null,
  profileRoot: null,
  windowWidth: 1280,
  windowHeight: 800,
  layout: {
    enabled: false,
    tileLayout: 'grid',
    tileCount: 4,
    gridColumns: 2,
    rowCount: 2,
    minimumCapacity: 1,
    targetDisplayId: null,
    tileWidthPx: 500,
    tileHeightPx: 500,
    autoFit: false
  }
}

export function normalizeZaloPhone(input: string): string {
  const digits = input.replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 15) throw new Error('Số điện thoại Zalo phải có 8-15 chữ số.')
  if (digits.startsWith('84') && digits.length >= 10) return `0${digits.slice(2)}`
  return digits
}

export function maskZaloPassword(password: string | null | undefined): string {
  if (!password) return ''
  return '••••••••'
}

export function redactZaloSecretText(input: string, secrets: Array<string | null | undefined>): string {
  let output = input
  for (const secret of secrets) {
    if (!secret) continue
    output = output.split(secret).join('[REDACTED]')
  }
  return output
}

export function cloneDefaultZaloBrowserSettings(): ZaloBrowserSettings {
  return {
    ...DEFAULT_ZALO_BROWSER_SETTINGS,
    layout: { ...DEFAULT_ZALO_BROWSER_SETTINGS.layout }
  }
}

export function assertValidZaloBrowserSettings(value: ZaloBrowserSettings): void {
  if (value.executablePath !== null && typeof value.executablePath !== 'string') throw new Error('Zalo executablePath không hợp lệ.')
  if (value.profileRoot !== null && typeof value.profileRoot !== 'string') throw new Error('Zalo profileRoot không hợp lệ.')
  if (!Number.isInteger(value.windowWidth) || value.windowWidth < 640 || value.windowWidth > 7680) throw new Error('Zalo windowWidth phải trong khoảng 640-7680.')
  if (!Number.isInteger(value.windowHeight) || value.windowHeight < 480 || value.windowHeight > 4320) throw new Error('Zalo windowHeight phải trong khoảng 480-4320.')
  const layout = value.layout
  if (!layout || typeof layout !== 'object') throw new Error('Zalo layout không hợp lệ.')
  if (!['grid', 'horizontal', 'vertical'].includes(layout.tileLayout)) throw new Error('Zalo tileLayout không hợp lệ.')
  if (!Number.isInteger(layout.tileCount) || layout.tileCount < 1 || layout.tileCount > 64) throw new Error('Zalo tileCount không hợp lệ.')
  if (!Number.isInteger(layout.gridColumns) || layout.gridColumns < 1 || layout.gridColumns > 8) throw new Error('Zalo gridColumns không hợp lệ.')
}
