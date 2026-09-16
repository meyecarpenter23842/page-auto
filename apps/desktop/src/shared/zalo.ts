import type { BrowserWindowLayoutSettings } from './browserWindowLayout'

export const ZALO_IPC = {
  list: 'zalo:accounts:list',
  create: 'zalo:accounts:create',
  update: 'zalo:accounts:update',
  delete: 'zalo:accounts:delete',
  open: 'zalo:accounts:open',
  login: 'zalo:accounts:login',
  close: 'zalo:accounts:close',
  actionExecute: 'zalo:actions:execute',
  actionPause: 'zalo:actions:pause',
  actionResume: 'zalo:actions:resume',
  actionStop: 'zalo:actions:stop',
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

export const ZALO_ACTION_TYPES = ['send_message', 'send_attachment', 'add_friend'] as const
export type ZaloActionType = (typeof ZALO_ACTION_TYPES)[number]
export type ZaloActionResultStatus = 'success' | 'needs_attention' | 'failed' | 'stopped'
export type ZaloActionResultCode =
  | 'success'
  | 'already_friend'
  | 'session_not_ready'
  | 'validation_error'
  | 'target_not_found'
  | 'target_unverified'
  | 'composer_missing'
  | 'send_control_missing'
  | 'attachment_control_missing'
  | 'friend_control_missing'
  | 'verification_uncertain'
  | 'stopped'
  | 'executor_exception'

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

export type ZaloActionInput =
  | { type: 'send_message'; targetPhone: string; content: string }
  | { type: 'send_attachment'; targetPhone: string; paths: string[] }
  | { type: 'add_friend'; targetPhone: string; message?: string | null }

export interface ZaloActionRequestPayload {
  id: number
  action: ZaloActionInput
}

export interface ZaloActionControlPayload { id: number }

export interface ZaloActionResult {
  accountId: number
  action: ZaloActionType
  targetPhone: string
  status: ZaloActionResultStatus
  code: ZaloActionResultCode
  message: string
  verifiedTarget: boolean
  targetDisplayName: string | null
  completedAt: number
  data?: Record<string, unknown>
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

export function normalizeZaloActionInput(input: ZaloActionInput): ZaloActionInput {
  const targetPhone = normalizeZaloPhone(input.targetPhone)
  if (input.type === 'send_message') {
    const content = input.content.trim()
    if (!content) throw new Error('Nội dung tin nhắn Zalo không được để trống.')
    if (content.length > 10_000) throw new Error('Nội dung tin nhắn Zalo quá dài.')
    return { type: input.type, targetPhone, content }
  }
  if (input.type === 'send_attachment') {
    const paths = input.paths.map((path) => path.trim()).filter(Boolean)
    if (!paths.length) throw new Error('Phải chọn ít nhất một ảnh/file để gửi Zalo.')
    if (paths.length > 20) throw new Error('Một action Zalo chỉ nhận tối đa 20 ảnh/file.')
    return { type: input.type, targetPhone, paths }
  }
  const message = input.message?.trim() || null
  if (message && message.length > 300) throw new Error('Lời nhắn kết bạn Zalo quá dài.')
  return { type: input.type, targetPhone, message }
}

export function zaloActionResult(
  accountId: number,
  action: ZaloActionType,
  targetPhone: string,
  status: ZaloActionResultStatus,
  code: ZaloActionResultCode,
  message: string,
  options: {
    verifiedTarget?: boolean
    targetDisplayName?: string | null
    data?: Record<string, unknown>
  } = {}
): ZaloActionResult {
  return {
    accountId,
    action,
    targetPhone,
    status,
    code,
    message,
    verifiedTarget: options.verifiedTarget ?? false,
    targetDisplayName: options.targetDisplayName ?? null,
    completedAt: Date.now(),
    ...(options.data === undefined ? {} : { data: options.data })
  }
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
