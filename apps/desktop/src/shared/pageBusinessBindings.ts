import type { ActionWorkspaceRecord } from './actionWorkspaces'
import type { PageTabScheduleInput } from './pageTabs'
import type { PageWallCanonicalPostSelection } from './pageWall'
import { parsePageJoinGroupWorkspaceConfig } from './pageJoinGroup'

export const PAGE_BUSINESS_TYPES = [
  'group_post',
  'page_wall_post',
  'page_edit',
  'join_group',
  'run_scenario'
] as const

export type PageBusinessType = (typeof PAGE_BUSINESS_TYPES)[number]
export type GenericPageBusinessType = Exclude<PageBusinessType, 'join_group'>

export interface PageBusinessBindingConfig {
  pageBusinessType: GenericPageBusinessType
  pageTabId: number
}

export interface PageWallBusinessScheduleSource {
  content: string
  imagePaths: string[]
  canonicalPost?: PageWallCanonicalPostSelection
}

export interface PageWallBusinessScheduleConfig extends PageWallBusinessScheduleSource {
  enabled: boolean
  schedules: PageTabScheduleInput[]
}

function isGenericType(value: unknown): value is GenericPageBusinessType {
  return value === 'group_post'
    || value === 'page_wall_post'
    || value === 'page_edit'
    || value === 'run_scenario'
}

function rawObject(configJson: string): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(configJson) as unknown
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function finiteInteger(value: unknown, min: number, max: number): number | null {
  const normalized = Number(value)
  return Number.isInteger(normalized) && normalized >= min && normalized <= max ? normalized : null
}

function normalizeScheduleArray(value: unknown): PageTabScheduleInput[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) return null
  const schedules: PageTabScheduleInput[] = []
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const record = raw as Record<string, unknown>
    const dayOfWeek = finiteInteger(record.dayOfWeek, 0, 6)
    const startMinute = finiteInteger(record.startMinute, 0, 1439)
    const endMinute = finiteInteger(record.endMinute, 1, 1440)
    if (dayOfWeek === null || startMinute === null || endMinute === null || startMinute >= endMinute) return null
    schedules.push({
      dayOfWeek,
      startMinute,
      endMinute,
      enabled: record.enabled !== false,
      sortOrder: index
    })
  }

  for (let day = 0; day <= 6; day += 1) {
    const active = schedules
      .filter((schedule) => schedule.enabled && schedule.dayOfWeek === day)
      .sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute)
    for (let index = 1; index < active.length; index += 1) {
      const previous = active[index - 1]
      const current = active[index]
      if (previous && current && current.startMinute < previous.endMinute) return null
    }
  }
  return schedules
}

function canonicalSelection(value: unknown): PageWallCanonicalPostSelection | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const image = record.image
  if (!image || typeof image !== 'object' || Array.isArray(image)) return undefined
  const imageRecord = image as Record<string, unknown>
  const postId = finiteInteger(record.postId, 1, Number.MAX_SAFE_INTEGER)
  const variantIndex = finiteInteger(record.variantIndex, 0, Number.MAX_SAFE_INTEGER)
  const mode = imageRecord.mode
  const missingPolicy = imageRecord.missingPolicy
  if (
    postId === null
    || variantIndex === null
    || typeof record.postName !== 'string'
    || typeof record.content !== 'string'
    || typeof imageRecord.folderPath !== 'string'
    || (mode !== 'sequential' && mode !== 'random' && mode !== 'filename_match')
    || !Number.isInteger(Number(imageRecord.imagesPerPost))
    || Number(imageRecord.imagesPerPost) < 1
    || (missingPolicy !== 'skip' && missingPolicy !== 'text_only')
  ) return undefined

  return {
    postId,
    postName: record.postName,
    variantIndex,
    content: record.content,
    image: {
      folderPath: imageRecord.folderPath,
      mode,
      imagesPerPost: Number(imageRecord.imagesPerPost),
      missingPolicy
    }
  }
}

export function normalizePageWallBusinessSchedule(value: PageWallBusinessScheduleConfig): PageWallBusinessScheduleConfig {
  const schedules = normalizeScheduleArray(value.schedules)
  if (!schedules) throw new Error('Lịch chạy Đăng Tường không hợp lệ hoặc có khung giờ chồng lấn.')
  if (value.enabled && !schedules.some((schedule) => schedule.enabled)) {
    throw new Error('Lịch chạy đang bật cần ít nhất một khung giờ bật.')
  }
  const imagePaths = Array.from(new Set(value.imagePaths.map((path) => path.trim()).filter(Boolean)))
  const canonicalPost = value.canonicalPost ? canonicalSelection(value.canonicalPost) : undefined
  if (value.canonicalPost && !canonicalPost) throw new Error('Bài canonical của Lịch chạy không hợp lệ.')
  if (!value.content.trim() && imagePaths.length === 0 && !canonicalPost) {
    throw new Error('Lịch chạy cần nội dung hoặc ảnh.')
  }
  return {
    enabled: Boolean(value.enabled),
    schedules,
    content: value.content,
    imagePaths,
    ...(canonicalPost ? { canonicalPost } : {})
  }
}

export function parsePageBusinessBindingConfig(configJson: string): PageBusinessBindingConfig | null {
  const record = rawObject(configJson)
  if (!record) return null
  const pageBusinessType = record.pageBusinessType
  const pageTabId = Number(record.pageTabId)
  if (!isGenericType(pageBusinessType) || !Number.isInteger(pageTabId) || pageTabId < 1) return null
  return { pageBusinessType, pageTabId }
}

export function parsePageWallBusinessSchedule(configJson: string): PageWallBusinessScheduleConfig | null {
  const base = parsePageBusinessBindingConfig(configJson)
  const record = rawObject(configJson)
  if (!base || base.pageBusinessType !== 'page_wall_post' || !record) return null
  const schedule = record.wallSchedule
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) return null
  const raw = schedule as Record<string, unknown>
  const schedules = normalizeScheduleArray(raw.schedules)
  if (!schedules) return null
  const imagePaths = Array.isArray(raw.imagePaths)
    ? Array.from(new Set(raw.imagePaths.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)))
    : []
  const canonicalPost = canonicalSelection(raw.canonicalPost)
  const content = typeof raw.content === 'string' ? raw.content : ''
  if (!content.trim() && imagePaths.length === 0 && !canonicalPost) return null
  return {
    enabled: raw.enabled === true,
    schedules,
    content,
    imagePaths,
    ...(canonicalPost ? { canonicalPost } : {})
  }
}

export function serializePageBusinessBindingConfig(
  pageBusinessType: GenericPageBusinessType,
  pageTabId: number
): string {
  if (!Number.isInteger(pageTabId) || pageTabId < 1) throw new Error('Page Tab ID không hợp lệ.')
  return JSON.stringify({ pageBusinessType, pageTabId })
}

export function serializePageWallBusinessSchedule(
  configJson: string,
  schedule: PageWallBusinessScheduleConfig | null
): string {
  const base = parsePageBusinessBindingConfig(configJson)
  const raw = rawObject(configJson)
  if (!base || base.pageBusinessType !== 'page_wall_post' || !raw) {
    throw new Error('Binding Đăng Tường không hợp lệ.')
  }
  const next: Record<string, unknown> = {
    ...raw,
    pageBusinessType: 'page_wall_post',
    pageTabId: base.pageTabId
  }
  if (schedule) next.wallSchedule = normalizePageWallBusinessSchedule(schedule)
  else delete next.wallSchedule
  return JSON.stringify(next)
}

export function pageBusinessTypeOf(workspace: ActionWorkspaceRecord): PageBusinessType | null {
  const generic = parsePageBusinessBindingConfig(workspace.configJson)
  if (generic) return generic.pageBusinessType
  if (workspace.type === 'group' && parsePageJoinGroupWorkspaceConfig(workspace.configJson)) return 'join_group'
  return null
}

export function pageBusinessPageIdOf(workspace: ActionWorkspaceRecord): number | null {
  const generic = parsePageBusinessBindingConfig(workspace.configJson)
  if (generic) return generic.pageTabId
  if (workspace.type !== 'group') return null
  return parsePageJoinGroupWorkspaceConfig(workspace.configJson)?.pageTabId ?? null
}

export function isPageBusinessWorkspace(workspace: ActionWorkspaceRecord): boolean {
  return pageBusinessTypeOf(workspace) !== null
}
