import type { AccountWritableField } from './accounts'

export const CHANGE_INFO_SUPPORT_STATUSES = ['audit_required', 'ready'] as const
export type ChangeInfoSupportStatus = (typeof CHANGE_INFO_SUPPORT_STATUSES)[number]

export const CHANGE_INFO_DATA_SOURCE_TYPES = [
  'fixed',
  'list',
  'file',
  'folder',
  'random_from_list',
  'sequential_from_list',
  'random_generator',
  'source_profile'
] as const
export type ChangeInfoDataSourceType = (typeof CHANGE_INFO_DATA_SOURCE_TYPES)[number]

export const CHANGE_INFO_CATEGORIES = [
  'personal',
  'education_work',
  'media',
  'privacy',
  'account_mode',
  'security_contact',
  'workflow'
] as const
export type ChangeInfoCategory = (typeof CHANGE_INFO_CATEGORIES)[number]
export type ChangeInfoValueKind = 'text' | 'boolean' | 'date' | 'media' | 'runtime_secret'
export type ChangeInfoDataScalar = string | number | boolean
export type ChangeInfoSourceSelectionMode = 'sequential' | 'random'

export interface ChangeInfoCatalogItem {
  key: string
  category: ChangeInfoCategory
  label: string
  description: string
  supportStatus: ChangeInfoSupportStatus
  actionType: string | null
  allowedSources: readonly ChangeInfoDataSourceType[]
  valueKind: ChangeInfoValueKind
  destructive?: boolean
  canonicalAccountField?: AccountWritableField
}

export interface ChangeInfoDataSourceConfig {
  type: ChangeInfoDataSourceType
  value?: ChangeInfoDataScalar
  values?: ChangeInfoDataScalar[]
  path?: string
  generatorId?: string
  sourceProfileUid?: string
  selectionMode?: ChangeInfoSourceSelectionMode
}

export interface ChangeInfoActionDraft {
  enabled: boolean
  source: ChangeInfoDataSourceConfig
}

export interface ChangeInfoWorkspaceDraft {
  version: 1
  accountConcurrency: number
  beforeScenarioId: number | null
  afterScenarioId: number | null
  verifyAfterChange: true
  actionOrder: string[]
  actions: Record<string, ChangeInfoActionDraft>
}

export interface ChangeInfoSourceResolutionContext {
  accountId: number
  accountIndex: number
  runSeed: string
  snapshotValues?: readonly ChangeInfoDataScalar[]
}

export type ChangeInfoSourceResolution =
  | { status: 'resolved'; value: ChangeInfoDataScalar; index: number | null }
  | { status: 'unresolved'; reason: string }

export const CHANGE_INFO_CATEGORY_LABELS: Record<ChangeInfoCategory, string> = {
  personal: 'Thông tin cá nhân',
  education_work: 'Học tập & công việc',
  media: 'Ảnh hồ sơ',
  privacy: 'Quyền riêng tư',
  account_mode: 'Chế độ tài khoản',
  security_contact: 'Bảo mật & liên hệ',
  workflow: 'Workflow & runtime'
}

const TEXT_SOURCES = ['fixed', 'list', 'file', 'random_from_list', 'sequential_from_list', 'random_generator'] as const
const LOCATION_SOURCES = ['fixed', 'list', 'file', 'random_from_list', 'sequential_from_list'] as const
const BOOLEAN_SOURCES = ['fixed', 'list', 'random_from_list', 'sequential_from_list'] as const
const MEDIA_SOURCES = ['folder'] as const
const NO_PERSISTED_SOURCE: readonly ChangeInfoDataSourceType[] = []

function item(
  key: string,
  category: ChangeInfoCategory,
  label: string,
  description: string,
  valueKind: ChangeInfoValueKind,
  allowedSources: readonly ChangeInfoDataSourceType[],
  options: Pick<ChangeInfoCatalogItem, 'destructive' | 'canonicalAccountField'> = {}
): ChangeInfoCatalogItem {
  return {
    key,
    category,
    label,
    description,
    valueKind,
    allowedSources,
    supportStatus: 'audit_required',
    actionType: null,
    ...options
  }
}

export const CHANGE_INFO_CATALOG: readonly ChangeInfoCatalogItem[] = [
  item('display_name', 'personal', 'Đổi tên', 'Display name của Profile.', 'text', TEXT_SOURCES, { canonicalAccountField: 'name' }),
  item('birthday', 'personal', 'Ngày sinh', 'Ngày sinh Profile.', 'date', LOCATION_SOURCES),
  item('gender', 'personal', 'Giới tính', 'Chỉ mở khi surface Facebook hiện hành audit được.', 'text', LOCATION_SOURCES),
  item('bio', 'personal', 'Tiểu sử', 'Bio / intro text.', 'text', TEXT_SOURCES),
  item('nickname', 'personal', 'Tên khác / nickname', 'Other name khi surface còn hỗ trợ.', 'text', TEXT_SOURCES),
  item('language', 'personal', 'Ngôn ngữ', 'Ngôn ngữ Profile/Facebook khi semantics được audit.', 'text', LOCATION_SOURCES),
  item('website', 'personal', 'Website', 'Website trong About nếu surface hiện hành hỗ trợ.', 'text', LOCATION_SOURCES),

  item('university', 'education_work', 'Đại học', 'University trong About.', 'text', LOCATION_SOURCES),
  item('high_school', 'education_work', 'Trường THPT', 'High School trong About.', 'text', LOCATION_SOURCES),
  item('work', 'education_work', 'Công việc / công ty', 'Work, company hoặc job title theo editor thực tế.', 'text', LOCATION_SOURCES),
  item('current_city', 'education_work', 'Nơi ở hiện tại', 'Current city / location.', 'text', LOCATION_SOURCES),
  item('hometown', 'education_work', 'Quê quán', 'Hometown.', 'text', LOCATION_SOURCES),
  item('relationship', 'education_work', 'Mối quan hệ', 'Relationship status.', 'text', LOCATION_SOURCES),

  item('avatar', 'media', 'Avatar', 'Chọn ảnh từ folder đã snapshot cho run.', 'media', MEDIA_SOURCES),
  item('cover', 'media', 'Ảnh bìa', 'Chọn ảnh cover từ folder đã snapshot cho run.', 'media', MEDIA_SOURCES),
  item('featured_photos', 'media', 'Ảnh nổi bật', 'Chỉ mở khi surface đủ ổn định.', 'media', MEDIA_SOURCES),

  item('enable_follow', 'privacy', 'Cho phép Follow', 'Follower setting với current-state reader + verifier.', 'boolean', BOOLEAN_SOURCES),
  item('friend_list_visibility', 'privacy', 'Hiển thị danh sách bạn bè', 'Friend list visibility.', 'text', LOCATION_SOURCES),
  item('birthday_visibility', 'privacy', 'Hiển thị ngày sinh', 'Birthday visibility.', 'text', LOCATION_SOURCES),
  item('contact_visibility', 'privacy', 'Hiển thị liên hệ', 'Email/phone visibility.', 'text', LOCATION_SOURCES),

  item('professional_mode', 'account_mode', 'Professional Mode', 'Bật/tắt Professional Mode sau live audit.', 'boolean', BOOLEAN_SOURCES),
  item('profile_protection', 'account_mode', 'Khóa/bảo vệ Profile', 'Region/account dependent; không giả support.', 'boolean', BOOLEAN_SOURCES),

  item('change_username', 'security_contact', 'Đổi username', 'Chỉ update canonical username sau verified success.', 'text', LOCATION_SOURCES, { canonicalAccountField: 'username' }),
  item('change_password', 'security_contact', 'Đổi mật khẩu Facebook', 'Secret mới chỉ được truyền runtime, không lưu preset/workspace.', 'runtime_secret', NO_PERSISTED_SOURCE, { destructive: true, canonicalAccountField: 'password' }),
  item('enable_2fa', 'security_contact', 'Bật 2FA', 'Security flow cần confirmation và verifier riêng.', 'runtime_secret', NO_PERSISTED_SOURCE, { destructive: true }),
  item('disable_2fa', 'security_contact', 'Tắt 2FA', 'Security flow destructive; không blind retry.', 'runtime_secret', NO_PERSISTED_SOURCE, { destructive: true }),
  item('logout_other_sessions', 'security_contact', 'Đăng xuất phiên khác', 'Logout other sessions/devices.', 'boolean', BOOLEAN_SOURCES, { destructive: true }),
  item('remove_email', 'security_contact', 'Xóa email', 'Contact mutation, audit/reuse canonical email flow.', 'text', LOCATION_SOURCES, { destructive: true }),
  item('remove_phone', 'security_contact', 'Xóa số điện thoại', 'Contact mutation, audit provider/verification riêng.', 'text', LOCATION_SOURCES, { destructive: true })
] as const

const CATALOG_BY_KEY = new Map(CHANGE_INFO_CATALOG.map((entry) => [entry.key, entry] as const))

export function getChangeInfoCatalogItem(key: string): ChangeInfoCatalogItem | undefined {
  return CATALOG_BY_KEY.get(key)
}

export function createChangeInfoDataSourceConfig(item: ChangeInfoCatalogItem, requestedType?: ChangeInfoDataSourceType): ChangeInfoDataSourceConfig {
  const type = requestedType && item.allowedSources.includes(requestedType) ? requestedType : item.allowedSources[0] ?? 'fixed'
  if (item.valueKind === 'boolean') return { type, value: true }
  if (type === 'folder' || type === 'file') return { type, path: '', selectionMode: 'sequential' }
  if (type === 'list' || type === 'random_from_list' || type === 'sequential_from_list') return { type, values: [] }
  return { type, value: '' }
}

export function createDefaultChangeInfoWorkspaceDraft(): ChangeInfoWorkspaceDraft {
  return {
    version: 1,
    accountConcurrency: 1,
    beforeScenarioId: null,
    afterScenarioId: null,
    verifyAfterChange: true,
    actionOrder: CHANGE_INFO_CATALOG.map((entry) => entry.key),
    actions: Object.fromEntries(CHANGE_INFO_CATALOG.map((entry) => [entry.key, {
      enabled: false,
      source: createChangeInfoDataSourceConfig(entry)
    }]))
  }
}

export const DEFAULT_CHANGE_INFO_WORKSPACE_DRAFT = createDefaultChangeInfoWorkspaceDraft()

function numberOrNull(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null
}

function normalizeScalar(value: unknown): ChangeInfoDataScalar | undefined {
  return typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) ? value : undefined
}

function normalizeSource(raw: unknown, catalog: ChangeInfoCatalogItem): ChangeInfoDataSourceConfig {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const requestedType = typeof source.type === 'string' && (CHANGE_INFO_DATA_SOURCE_TYPES as readonly string[]).includes(source.type)
    ? source.type as ChangeInfoDataSourceType
    : catalog.allowedSources[0] ?? 'fixed'
  const type = catalog.allowedSources.includes(requestedType) ? requestedType : catalog.allowedSources[0] ?? 'fixed'
  const value = normalizeScalar(source.value)
  const values = Array.isArray(source.values)
    ? source.values.map(normalizeScalar).filter((entry): entry is ChangeInfoDataScalar => entry !== undefined)
    : []
  return {
    type,
    ...(value === undefined ? {} : { value }),
    ...(values.length ? { values } : {}),
    ...(typeof source.path === 'string' ? { path: source.path } : {}),
    ...(typeof source.generatorId === 'string' ? { generatorId: source.generatorId } : {}),
    ...(typeof source.sourceProfileUid === 'string' ? { sourceProfileUid: source.sourceProfileUid } : {}),
    ...((source.selectionMode === 'random' || source.selectionMode === 'sequential') ? { selectionMode: source.selectionMode } : {})
  }
}

export function parseChangeInfoWorkspaceDraft(input: string | unknown): ChangeInfoWorkspaceDraft {
  let parsed: unknown = input
  if (typeof input === 'string') {
    try { parsed = JSON.parse(input) } catch { parsed = {} }
  }
  const source = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  const defaults = createDefaultChangeInfoWorkspaceDraft()
  const rawActions = source.actions && typeof source.actions === 'object' && !Array.isArray(source.actions)
    ? source.actions as Record<string, unknown>
    : {}
  const actions: Record<string, ChangeInfoActionDraft> = {}
  for (const catalog of CHANGE_INFO_CATALOG) {
    const rawAction = rawActions[catalog.key]
    const action = rawAction && typeof rawAction === 'object' && !Array.isArray(rawAction) ? rawAction as Record<string, unknown> : {}
    actions[catalog.key] = {
      enabled: action.enabled === true,
      source: normalizeSource(action.source, catalog)
    }
  }
  const requestedOrder = Array.isArray(source.actionOrder)
    ? source.actionOrder.filter((key): key is string => typeof key === 'string' && CATALOG_BY_KEY.has(key))
    : []
  const uniqueOrder = [...new Set(requestedOrder)]
  for (const catalog of CHANGE_INFO_CATALOG) if (!uniqueOrder.includes(catalog.key)) uniqueOrder.push(catalog.key)
  const concurrency = typeof source.accountConcurrency === 'number' && Number.isFinite(source.accountConcurrency)
    ? Math.min(20, Math.max(1, Math.floor(source.accountConcurrency)))
    : defaults.accountConcurrency
  return {
    version: 1,
    accountConcurrency: concurrency,
    beforeScenarioId: numberOrNull(source.beforeScenarioId),
    afterScenarioId: numberOrNull(source.afterScenarioId),
    verifyAfterChange: true,
    actionOrder: uniqueOrder,
    actions
  }
}

export function serializeChangeInfoWorkspaceDraft(draft: ChangeInfoWorkspaceDraft): string {
  return JSON.stringify(parseChangeInfoWorkspaceDraft(draft))
}

export function enabledChangeInfoCatalogItems(draft: ChangeInfoWorkspaceDraft): ChangeInfoCatalogItem[] {
  const normalized = parseChangeInfoWorkspaceDraft(draft)
  return normalized.actionOrder
    .map((key) => CATALOG_BY_KEY.get(key))
    .filter((entry): entry is ChangeInfoCatalogItem => Boolean(entry && normalized.actions[entry.key]?.enabled))
}

function hasUsableSource(source: ChangeInfoDataSourceConfig): boolean {
  if (source.type === 'fixed') return source.value !== undefined && String(source.value).trim() !== ''
  if (source.type === 'list' || source.type === 'random_from_list' || source.type === 'sequential_from_list') return Boolean(source.values?.length)
  if (source.type === 'file' || source.type === 'folder') return Boolean(source.path?.trim())
  if (source.type === 'random_generator') return Boolean(source.generatorId?.trim())
  if (source.type === 'source_profile') return Boolean(source.sourceProfileUid?.trim())
  return false
}

export function validateChangeInfoWorkspaceDraft(draft: ChangeInfoWorkspaceDraft): string[] {
  const normalized = parseChangeInfoWorkspaceDraft(draft)
  const errors: string[] = []
  if (normalized.accountConcurrency < 1 || normalized.accountConcurrency > 20) errors.push('TK song song phải từ 1 đến 20.')
  const enabled = enabledChangeInfoCatalogItems(normalized)
  if (!enabled.length) errors.push('Cần chọn ít nhất một thay đổi.')
  for (const catalog of enabled) {
    const action = normalized.actions[catalog.key]!
    if (catalog.supportStatus !== 'ready' || !catalog.actionType) {
      errors.push(`${catalog.label}: cần live audit trước khi có thể chạy.`)
      continue
    }
    if (!catalog.allowedSources.includes(action.source.type)) errors.push(`${catalog.label}: nguồn dữ liệu không được hỗ trợ.`)
    if (catalog.allowedSources.length > 0 && !hasUsableSource(action.source)) errors.push(`${catalog.label}: nguồn dữ liệu chưa đủ.`)
  }
  return errors
}

function stableHash(input: string): number {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function resolveChangeInfoDataSource(
  source: ChangeInfoDataSourceConfig,
  context: ChangeInfoSourceResolutionContext
): ChangeInfoSourceResolution {
  if (source.type === 'fixed') {
    return source.value === undefined
      ? { status: 'unresolved', reason: 'Nguồn cố định chưa có giá trị.' }
      : { status: 'resolved', value: source.value, index: null }
  }

  const values = source.type === 'file' || source.type === 'folder'
    ? [...(context.snapshotValues ?? [])]
    : [...(source.values ?? [])]
  if (source.type === 'random_generator') return { status: 'unresolved', reason: 'Generator cần resolver đã audit riêng.' }
  if (source.type === 'source_profile') return { status: 'unresolved', reason: 'Source Profile cần collector đã audit riêng.' }
  if (!values.length) return { status: 'unresolved', reason: 'Nguồn dữ liệu snapshot đang rỗng.' }

  const randomSelection = source.type === 'random_from_list'
    || ((source.type === 'file' || source.type === 'folder') && source.selectionMode === 'random')
  const index = randomSelection
    ? stableHash(`${context.runSeed}:${context.accountId}`) % values.length
    : context.accountIndex % values.length
  const value = values[index]
  return value === undefined
    ? { status: 'unresolved', reason: 'Không resolve được giá trị.' }
    : { status: 'resolved', value, index }
}
