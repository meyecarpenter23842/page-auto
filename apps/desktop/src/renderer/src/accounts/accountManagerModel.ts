import {
  type AccountColumnLayout,
  type AccountDraft,
  type AccountImportField,
  type AccountImportMapping,
  type AccountRecord
} from '../../../shared/accounts'
import type { AccountGroupOverview } from '../../../shared/accountGroups'

export type ColumnId = keyof AccountRecord

export type GridColumn = {
  id: ColumnId
  label: string
  defaultVisible: boolean
  sensitive?: boolean
  width: number
}

export type ContextMenuState = {
  x: number
  y: number
} | null

export type PreviewRow = {
  line: number
  raw: string
  values: string[]
}

export const EMPTY_GROUP_OVERVIEW: AccountGroupOverview = {
  groups: [],
  totalAccounts: 0,
  ungroupedCount: 0
}

export const accountStatusLabels: Record<AccountRecord['status'], string> = {
  unknown: 'Chưa kiểm tra',
  valid: 'Hoạt động',
  needs_login: 'Cần đăng nhập',
  disabled: 'Đã tắt'
}

export const columns: GridColumn[] = [
  { id: 'uid', label: 'UID / Tên đăng nhập', defaultVisible: true, width: 160 },
  { id: 'name', label: 'Tên tài khoản', defaultVisible: true, width: 150 },
  { id: 'status', label: 'Trạng thái', defaultVisible: true, width: 115 },
  { id: 'category', label: 'Nhóm', defaultVisible: true, width: 130 },
  { id: 'cookieStatus', label: 'Trạng thái cookie', defaultVisible: true, width: 130 },
  { id: 'proxy', label: 'Proxy', defaultVisible: true, width: 175 },
  { id: 'note', label: 'Ghi chú', defaultVisible: true, width: 220 },
  { id: 'lastUsedAt', label: 'Lần dùng cuối', defaultVisible: true, width: 145 },
  { id: 'username', label: 'Tên đăng nhập riêng', defaultVisible: false, width: 155 },
  { id: 'password', label: 'Mật khẩu', defaultVisible: false, sensitive: true, width: 145 },
  { id: 'cookie', label: 'Cookie', defaultVisible: false, sensitive: true, width: 210 },
  { id: 'twoFactorSecret', label: '2FA', defaultVisible: false, sensitive: true, width: 135 },
  { id: 'email', label: 'Email', defaultVisible: false, width: 185 },
  { id: 'emailPassword', label: 'Mật khẩu email', defaultVisible: false, sensitive: true, width: 145 },
  { id: 'backupEmail', label: 'Email dự phòng', defaultVisible: false, width: 185 },
  { id: 'phone', label: 'Điện thoại', defaultVisible: false, width: 130 },
  { id: 'friendCount', label: 'Bạn bè', defaultVisible: false, width: 90 },
  { id: 'createdDate', label: 'Ngày tạo', defaultVisible: false, width: 125 },
  { id: 'userAgent', label: 'User-Agent', defaultVisible: false, width: 250 },
  { id: 'proxyType', label: 'Loại proxy', defaultVisible: false, width: 105 },
  { id: 'proxyHost', label: 'Máy chủ proxy', defaultVisible: false, width: 145 },
  { id: 'proxyPort', label: 'Cổng proxy', defaultVisible: false, width: 95 },
  { id: 'proxyUsername', label: 'Tài khoản proxy', defaultVisible: false, width: 135 },
  { id: 'proxyPassword', label: 'Mật khẩu proxy', defaultVisible: false, sensitive: true, width: 135 },
  { id: 'lastCookieCheck', label: 'Kiểm tra cookie', defaultVisible: false, width: 145 },
  { id: 'createdAt', label: 'Ngày thêm', defaultVisible: false, width: 145 },
  { id: 'updatedAt', label: 'Cập nhật lúc', defaultVisible: false, width: 145 }
]

export const columnById = new Map(columns.map((column) => [column.id, column]))
export const defaultLayout: AccountColumnLayout = {
  order: columns.map((column) => column.id),
  hidden: columns.filter((column) => !column.defaultVisible).map((column) => column.id),
  widths: Object.fromEntries(columns.map((column) => [column.id, column.width]))
}

export const importFieldLabels: Record<AccountImportField | 'ignore', string> = {
  ignore: 'Bỏ qua',
  uid: 'UID/Tên đăng nhập',
  username: 'Tên đăng nhập riêng',
  password: 'Mật khẩu',
  name: 'Tên tài khoản',
  cookie: 'Cookie',
  twoFactorSecret: '2FA',
  email: 'Email',
  emailPassword: 'Mật khẩu email',
  backupEmail: 'Email dự phòng',
  phone: 'Điện thoại',
  proxy: 'Proxy',
  proxyType: 'Loại proxy',
  proxyHost: 'Máy chủ proxy',
  proxyPort: 'Cổng proxy',
  proxyUsername: 'Tài khoản proxy',
  proxyPassword: 'Mật khẩu proxy',
  userAgent: 'User-Agent',
  category: 'Nhóm',
  note: 'Ghi chú',
  friendCount: 'Bạn bè',
  createdDate: 'Ngày tạo'
}

export const DEFAULT_CUSTOM_MAPPING: AccountImportMapping = [
  'uid',
  'password',
  'twoFactorSecret',
  'cookie',
  'email',
  'emailPassword',
  'proxy',
  'userAgent',
  'note'
]
export const MIN_CUSTOM_MAPPING_COLUMNS = DEFAULT_CUSTOM_MAPPING.length
export const PREVIEW_LIMIT = 12
export const ACCOUNT_RUNTIME_REFRESH_MS = 1_500
export const UNGROUPED_CATEGORY_FILTER = '__ungrouped__'

export function formatDate(value: unknown): string {
  if (typeof value !== 'number' || !value) return '—'
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(value)
}

export function formatCellValue(account: AccountRecord, column: GridColumn): string {
  const value = account[column.id]
  if (value === null || value === undefined || value === '') return '—'
  if (['lastUsedAt', 'lastCookieCheck', 'createdAt', 'updatedAt'].includes(column.id)) return formatDate(value)
  return String(value)
}

export function maskSecret(value: string): string {
  if (!value) return '—'
  if (value.length <= 6) return '••••••'
  return `${value.slice(0, 3)}••••••${value.slice(-3)}`
}

export function normalizeLayout(saved: AccountColumnLayout | null): AccountColumnLayout {
  if (!saved) return defaultLayout
  const known = new Set(columns.map((column) => column.id))
  const order = saved.order.filter((id) => known.has(id as ColumnId))
  for (const column of columns) {
    if (!order.includes(column.id)) order.push(column.id)
  }
  return {
    order,
    hidden: saved.hidden.filter((id) => known.has(id as ColumnId)),
    widths: { ...defaultLayout.widths, ...saved.widths }
  }
}

export function normalizeCustomMapping(mapping: AccountImportMapping, targetLength = MIN_CUSTOM_MAPPING_COLUMNS): AccountImportMapping {
  const length = Math.max(targetLength, MIN_CUSTOM_MAPPING_COLUMNS)
  return Array.from({ length }, (_, index) => mapping[index] ?? DEFAULT_CUSTOM_MAPPING[index] ?? 'ignore')
}

export function accountToDraft(account: AccountRecord): AccountDraft {
  return {
    uid: account.uid,
    username: account.username,
    password: account.password,
    name: account.name,
    status: account.status,
    category: account.category,
    friendCount: account.friendCount,
    cookie: account.cookie,
    cookieStatus: account.cookieStatus,
    lastCookieCheck: account.lastCookieCheck,
    proxy: account.proxy,
    proxyType: account.proxyType,
    proxyHost: account.proxyHost,
    proxyPort: account.proxyPort,
    proxyUsername: account.proxyUsername,
    proxyPassword: account.proxyPassword,
    twoFactorSecret: account.twoFactorSecret,
    email: account.email,
    emailPassword: account.emailPassword,
    backupEmail: account.backupEmail,
    phone: account.phone,
    userAgent: account.userAgent,
    createdDate: account.createdDate,
    note: account.note,
    lastUsedAt: account.lastUsedAt
  }
}
