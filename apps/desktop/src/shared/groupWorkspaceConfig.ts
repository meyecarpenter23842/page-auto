import type { ActionConfig } from './actionRegistry'

export const GROUP_JOIN_SOURCE_MODES = [
  'keyword',
  'suggestions',
  'id_distribute',
  'id_limit',
  'id_shared',
  'file',
  'account_file'
] as const

export type GroupJoinSourceMode = typeof GROUP_JOIN_SOURCE_MODES[number]

export interface GroupWorkspaceDraft {
  sourceMode: GroupJoinSourceMode
  keyword: string
  sourceTargets: string
  sourceFileLabel: string
  accountFilePath: string
  limitPerAccount: number
  answerQuestionsEnabled: boolean
  answerQuestions: string
  joinMin: number
  joinMax: number
  memberFilterEnabled: boolean
  memberMin: number
  memberMax: number
  privacyOpen: boolean
  privacyClosed: boolean
  skipApprovalRequired: boolean
  locationEnabled: boolean
  locationKeyword: string
  localeEnabled: boolean
  locale: string
  itemDelayMinSeconds: number
  itemDelayMaxSeconds: number
  pauseAfterCount: number
  pauseMinutes: number
  errorPauseMinutes: number
  repeatEnabled: boolean
  repeatCount: number
}

export const DEFAULT_GROUP_WORKSPACE_DRAFT: GroupWorkspaceDraft = {
  sourceMode: 'id_distribute',
  keyword: '',
  sourceTargets: '',
  sourceFileLabel: '',
  accountFilePath: '',
  limitPerAccount: 100,
  answerQuestionsEnabled: true,
  answerQuestions: '',
  joinMin: 5,
  joinMax: 20,
  memberFilterEnabled: true,
  memberMin: 10_000,
  memberMax: 0,
  privacyOpen: true,
  privacyClosed: true,
  skipApprovalRequired: false,
  locationEnabled: false,
  locationKeyword: 'Viet Nam',
  localeEnabled: false,
  locale: 'vi_VN',
  itemDelayMinSeconds: 200,
  itemDelayMaxSeconds: 300,
  pauseAfterCount: 30,
  pauseMinutes: 15,
  errorPauseMinutes: 10,
  repeatEnabled: false,
  repeatCount: 1
}

const SOURCE_MODES = new Set<string>(GROUP_JOIN_SOURCE_MODES)

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  return Math.floor(boundedNumber(value, fallback, min, max))
}

export function cloneDefaultGroupWorkspaceDraft(): GroupWorkspaceDraft {
  return { ...DEFAULT_GROUP_WORKSPACE_DRAFT }
}

export function parseGroupWorkspaceDraft(configJson: string): GroupWorkspaceDraft {
  const fallback = cloneDefaultGroupWorkspaceDraft()
  let parsed: unknown
  try {
    parsed = JSON.parse(configJson)
  } catch {
    return fallback
  }
  const raw = objectValue(parsed)
  if (!raw) return fallback

  return {
    sourceMode: typeof raw.sourceMode === 'string' && SOURCE_MODES.has(raw.sourceMode)
      ? raw.sourceMode as GroupJoinSourceMode
      : fallback.sourceMode,
    keyword: text(raw.keyword, fallback.keyword),
    sourceTargets: text(raw.sourceTargets, fallback.sourceTargets),
    sourceFileLabel: text(raw.sourceFileLabel, fallback.sourceFileLabel),
    accountFilePath: text(raw.accountFilePath, fallback.accountFilePath),
    limitPerAccount: boundedInteger(raw.limitPerAccount, fallback.limitPerAccount, 1, 100_000),
    answerQuestionsEnabled: bool(raw.answerQuestionsEnabled, fallback.answerQuestionsEnabled),
    answerQuestions: text(raw.answerQuestions, fallback.answerQuestions),
    joinMin: boundedInteger(raw.joinMin, fallback.joinMin, 1, 5000),
    joinMax: boundedInteger(raw.joinMax, fallback.joinMax, 1, 5000),
    memberFilterEnabled: bool(raw.memberFilterEnabled, fallback.memberFilterEnabled),
    memberMin: boundedInteger(raw.memberMin, fallback.memberMin, 0, 1_000_000_000),
    memberMax: boundedInteger(raw.memberMax, fallback.memberMax, 0, 1_000_000_000),
    privacyOpen: bool(raw.privacyOpen, fallback.privacyOpen),
    privacyClosed: bool(raw.privacyClosed, fallback.privacyClosed),
    skipApprovalRequired: bool(raw.skipApprovalRequired, fallback.skipApprovalRequired),
    locationEnabled: bool(raw.locationEnabled, fallback.locationEnabled),
    locationKeyword: text(raw.locationKeyword, fallback.locationKeyword),
    localeEnabled: bool(raw.localeEnabled, fallback.localeEnabled),
    locale: text(raw.locale, fallback.locale),
    itemDelayMinSeconds: boundedNumber(raw.itemDelayMinSeconds, fallback.itemDelayMinSeconds, 0, 3600),
    itemDelayMaxSeconds: boundedNumber(raw.itemDelayMaxSeconds, fallback.itemDelayMaxSeconds, 0, 3600),
    pauseAfterCount: boundedInteger(raw.pauseAfterCount, fallback.pauseAfterCount, 0, 10_000),
    pauseMinutes: boundedNumber(raw.pauseMinutes, fallback.pauseMinutes, 0, 1440),
    errorPauseMinutes: boundedNumber(raw.errorPauseMinutes, fallback.errorPauseMinutes, 0, 1440),
    repeatEnabled: bool(raw.repeatEnabled, fallback.repeatEnabled),
    repeatCount: boundedInteger(raw.repeatCount, fallback.repeatCount, 1, 999)
  }
}

export function serializeGroupWorkspaceDraft(draft: GroupWorkspaceDraft): string {
  return JSON.stringify(draft)
}

export function splitGroupTargets(value: string): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const raw of value.split(/\r?\n|\|/g)) {
    const item = raw.trim()
    if (!item || seen.has(item)) continue
    seen.add(item)
    output.push(item)
  }
  return output
}

export function groupSourceNeedsTargets(mode: GroupJoinSourceMode): boolean {
  return mode !== 'keyword' && mode !== 'suggestions'
}

export function allocateGroupTargets(
  draft: GroupWorkspaceDraft,
  targets: readonly string[],
  accountIndex: number,
  accountCount: number
): string[] {
  if (draft.sourceMode === 'id_distribute') {
    const count = Math.max(1, accountCount)
    return targets.filter((_item, index) => index % count === accountIndex)
  }
  if (draft.sourceMode === 'id_limit') {
    const limit = Math.max(1, Math.floor(draft.limitPerAccount))
    const start = accountIndex * limit
    return targets.slice(start, start + limit)
  }
  if (draft.sourceMode === 'id_shared' || draft.sourceMode === 'file') return [...targets]
  return []
}

export function buildJoinGroupActionConfig(draft: GroupWorkspaceDraft, targets: readonly string[]): ActionConfig {
  const sourceMode = draft.sourceMode === 'keyword'
    ? 'keyword'
    : draft.sourceMode === 'suggestions'
      ? 'suggestions'
      : 'id_list'

  return {
    sourceMode,
    sourceTargets: sourceMode === 'id_list' ? targets.join('\n') : '',
    keyword: sourceMode === 'keyword' ? draft.keyword.trim() : '',
    answerQuestions: draft.answerQuestionsEnabled ? draft.answerQuestions : '',
    joinMin: draft.joinMin,
    joinMax: draft.joinMax,
    memberFilterEnabled: draft.memberFilterEnabled,
    memberMin: draft.memberMin,
    memberMax: draft.memberMax,
    privacyOpen: draft.privacyOpen,
    privacyClosed: draft.privacyClosed,
    skipApprovalRequired: draft.skipApprovalRequired,
    locationEnabled: draft.locationEnabled,
    locationKeyword: draft.locationKeyword,
    localeEnabled: draft.localeEnabled,
    locale: draft.locale,
    itemDelayMinSeconds: draft.itemDelayMinSeconds,
    itemDelayMaxSeconds: draft.itemDelayMaxSeconds,
    pauseAfterCount: draft.pauseAfterCount,
    pauseMinutes: draft.pauseMinutes,
    errorPauseMinutes: draft.errorPauseMinutes
  }
}

export function validateGroupWorkspaceDraft(draft: GroupWorkspaceDraft, enabledAccountCount: number): string[] {
  const errors: string[] = []
  if (enabledAccountCount < 1) errors.push('Cần bật ít nhất một tài khoản.')
  if (draft.joinMin > draft.joinMax) errors.push('Số lượng nhóm: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.')
  if (draft.itemDelayMinSeconds > draft.itemDelayMaxSeconds) errors.push('Delay nghiệp vụ: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.')
  if (!draft.privacyOpen && !draft.privacyClosed) errors.push('Privacy: cần chọn ít nhất OPEN hoặc CLOSED.')
  if (draft.memberFilterEnabled && draft.memberMax > 0 && draft.memberMin > draft.memberMax) {
    errors.push('Số thành viên: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.')
  }
  if (draft.locationEnabled && !draft.locationKeyword.trim()) errors.push('Location: cần nhập giá trị khi bật lọc.')
  if (draft.localeEnabled && !draft.locale.trim()) errors.push('Locale: cần nhập giá trị khi bật lọc.')

  if (draft.sourceMode === 'keyword' && !draft.keyword.trim()) {
    errors.push('Nguồn theo từ khóa: cần nhập từ khóa.')
  }
  if (draft.sourceMode === 'account_file' && !draft.accountFilePath.trim()) {
    errors.push('1 account / 1 file ID: cần chọn folder hoặc nhập đường dẫn có {uid}.')
  }
  if (['id_distribute', 'id_limit', 'id_shared', 'file'].includes(draft.sourceMode) && splitGroupTargets(draft.sourceTargets).length === 0) {
    errors.push('Nguồn Group ID: cần nhập danh sách hoặc nạp file.')
  }
  return errors
}
