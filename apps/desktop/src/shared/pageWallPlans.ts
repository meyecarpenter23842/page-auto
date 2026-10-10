export const PAGE_WALL_PLAN_SCHEDULE_KINDS = ['specific_date', 'daily'] as const
export type PageWallPlanScheduleKind = (typeof PAGE_WALL_PLAN_SCHEDULE_KINDS)[number]

export const PAGE_WALL_PLAN_STATUSES = ['active', 'completed', 'disabled', 'needs_attention'] as const
export type PageWallPlanStatus = (typeof PAGE_WALL_PLAN_STATUSES)[number]

export const PAGE_WALL_PLAN_OCCURRENCE_STATUSES = [
  'pending',
  'running',
  'success',
  'failed',
  'needs_attention',
  'cancelled'
] as const
export type PageWallPlanOccurrenceStatus = (typeof PAGE_WALL_PLAN_OCCURRENCE_STATUSES)[number]

export interface PageWallPlanCanonicalPostSource {
  kind: 'canonical'
  /** Canonical Post Library identity. Material is resolved when an occurrence starts. */
  postId: number
  variantIndex: number
}

export interface PageWallPlanManualPostSource {
  kind: 'manual'
  content: string
  imagePaths: string[]
}

export type PageWallPlanPostSource = PageWallPlanCanonicalPostSource | PageWallPlanManualPostSource

/**
 * Explicit finite mapping owned by a Wall plan. No account x post cartesian product,
 * random assignment or round-robin behavior may be inferred outside these rows.
 */
export interface PageWallPlanTaskDefinition {
  accountId: number
  source: PageWallPlanPostSource
  sortOrder: number
}

export interface SavePageWallPlanInput {
  pageTabId: number
  scheduleKind: PageWallPlanScheduleKind
  /** YYYY-MM-DD for specific_date. Daily plans intentionally keep this null. */
  localDate?: string | null
  /** Local machine minute of day, 0..1439. */
  minuteOfDay: number
  accountConcurrency: number
  tasks: PageWallPlanTaskDefinition[]
  enabled: boolean
}

export interface PageWallPlanRecord {
  id: number
  pageTabId: number
  scheduleKind: PageWallPlanScheduleKind
  localDate: string | null
  minuteOfDay: number
  accountConcurrency: number
  tasks: PageWallPlanTaskDefinition[]
  taskCount: number
  status: PageWallPlanStatus
  lastError: string | null
  createdAt: number
  updatedAt: number
}

export interface PageWallPlanOccurrenceRecord {
  id: number
  planId: number
  occurrenceKey: string
  localDate: string
  scheduledAt: number
  status: PageWallPlanOccurrenceStatus
  /** Immutable snapshot from the plan when this occurrence is created. */
  accountConcurrency: number
  taskCount: number
  resultMessage: string | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  updatedAt: number
}

export interface PageWallPlanOccurrenceJobLink {
  occurrenceId: number
  jobId: number
  taskOrder: number
}

function assertPositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} không hợp lệ.`)
  return value
}

function normalizeImagePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const raw of Array.isArray(paths) ? paths : []) {
    if (typeof raw !== 'string') continue
    const path = raw.trim()
    if (!path || seen.has(path)) continue
    seen.add(path)
    normalized.push(path)
  }
  return normalized
}

export function normalizePageWallPlanLocalDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) throw new Error('Ngày chạy không hợp lệ.')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (
    probe.getUTCFullYear() !== year
    || probe.getUTCMonth() !== month - 1
    || probe.getUTCDate() !== day
  ) {
    throw new Error('Ngày chạy không hợp lệ.')
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function normalizePageWallPlanTasks(tasks: PageWallPlanTaskDefinition[]): PageWallPlanTaskDefinition[] {
  if (!Array.isArray(tasks) || tasks.length === 0) throw new Error('Kế hoạch Đăng Tường cần ít nhất một task.')
  if (tasks.length > 1_000) throw new Error('Kế hoạch Đăng Tường có quá nhiều task.')

  return tasks.map((task, index) => {
    const accountId = assertPositiveInteger(task.accountId, 'Tài khoản của task')
    const rawSortOrder = Number.isInteger(task.sortOrder) && task.sortOrder >= 0 ? task.sortOrder : index
    if (task.source.kind === 'canonical') {
      const postId = assertPositiveInteger(task.source.postId, 'Bài viết của task')
      if (!Number.isInteger(task.source.variantIndex) || task.source.variantIndex < 0) {
        throw new Error('Biến thể bài viết của task không hợp lệ.')
      }
      return {
        accountId,
        source: {
          kind: 'canonical' as const,
          postId,
          variantIndex: task.source.variantIndex
        },
        sortOrder: rawSortOrder
      }
    }

    const content = typeof task.source.content === 'string' ? task.source.content : ''
    const imagePaths = normalizeImagePaths(task.source.imagePaths)
    if (!content.trim() && imagePaths.length === 0) {
      throw new Error('Task Đăng Tường phải có nội dung hoặc ít nhất một ảnh.')
    }
    return {
      accountId,
      source: { kind: 'manual' as const, content, imagePaths },
      sortOrder: rawSortOrder
    }
  }).sort((left, right) => left.sortOrder - right.sortOrder || left.accountId - right.accountId)
    .map((task, sortOrder) => ({ ...task, sortOrder }))
}

export function normalizePageWallPlanInput(input: SavePageWallPlanInput): SavePageWallPlanInput {
  const pageTabId = assertPositiveInteger(input.pageTabId, 'Page của kế hoạch')
  if (!PAGE_WALL_PLAN_SCHEDULE_KINDS.includes(input.scheduleKind)) throw new Error('Loại lịch Đăng Tường không hợp lệ.')
  if (!Number.isInteger(input.minuteOfDay) || input.minuteOfDay < 0 || input.minuteOfDay > 1439) {
    throw new Error('Giờ chạy Đăng Tường không hợp lệ.')
  }
  if (!Number.isInteger(input.accountConcurrency) || input.accountConcurrency < 1 || input.accountConcurrency > 20) {
    throw new Error('TK chạy song song của Đăng Tường phải từ 1 đến 20.')
  }

  const localDate = input.scheduleKind === 'specific_date'
    ? normalizePageWallPlanLocalDate(input.localDate ?? '')
    : null

  return {
    pageTabId,
    scheduleKind: input.scheduleKind,
    localDate,
    minuteOfDay: input.minuteOfDay,
    accountConcurrency: input.accountConcurrency,
    tasks: normalizePageWallPlanTasks(input.tasks),
    enabled: input.enabled !== false
  }
}

/** DB uniqueness is (plan_id, occurrence_key), so local date gives one occurrence per plan/day. */
export function pageWallPlanOccurrenceKey(localDate: string): string {
  return normalizePageWallPlanLocalDate(localDate)
}
