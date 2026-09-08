import type { PageTabStatus } from './pageTabs'
import type {
  RotationAccountRuntimeStatus,
  RotationRuntimeStatus,
  RotationWindowRuntimeStatus
} from './rotation'
import type { RunStatus } from './runs'

export const PWA_BRIDGE_SCHEMA_VERSION = 1 as const
export const PWA_BRIDGE_STALE_AFTER_MS = 15_000
export const PWA_REMOTE_COMMAND_SCHEMA_VERSION = 1 as const
export const PWA_REMOTE_COMMAND_TARGET = 'group_post' as const
export const PWA_REMOTE_COMMAND_MAX_TTL_MS = 60_000
export const PWA_REMOTE_COMMAND_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/
export const PWA_GROUP_POST_COMMAND_ACTIONS = ['start', 'pause', 'resume', 'stop'] as const

export type PwaGroupPostCommandAction = (typeof PWA_GROUP_POST_COMMAND_ACTIONS)[number]
export type PwaGroupPostCommandResultCode =
  | 'ok'
  | 'invalid_command'
  | 'expired'
  | 'page_not_found'
  | 'invalid_state'
  | 'command_conflict'
  | 'runtime_error'

export interface PwaBridgeSummary {
  totalPages: number
  activePages: number
  pausedPages: number
  successToday: number
  failedToday: number
  nextActionAt: number | null
}

export interface PwaBridgeAccountSnapshot {
  accountId: number
  uid: string
  name: string | null
  status: RotationAccountRuntimeStatus
  message: string | null
}

export interface PwaBridgeScheduleSnapshot {
  dayOfWeek: number
  startMinute: number
  endMinute: number
  status: RotationWindowRuntimeStatus | null
  currentAccountId: number | null
  groupRemaining: number | null
}

export interface PwaBridgeCurrentPostSnapshot {
  groupUid: string
  contentPreview: string
  contentLength: number
  imageCount: number
  postIndex: number
  variantIndex: number
}

export interface PwaBridgePageSnapshot {
  pageTabId: number
  name: string
  pageUid: string
  configuredStatus: PageTabStatus
  runtimeStatus: RotationRuntimeStatus
  runId: number | null
  runStatus: RunStatus | null
  message: string | null
  accountCount: number
  groupCount: number
  accountConcurrency: number
  postsPerAccount: number
  currentAccountId: number | null
  currentGroupUid: string | null
  nextActionAt: number | null
  cycle: number
  slotsCompletedThisTurn: number
  targetSlotsThisTurn: number
  progress: {
    total: number
    success: number
    failed: number
    skipped: number
    remaining: number
    percent: number
  } | null
  today: {
    success: number
    failed: number
  }
  accounts: PwaBridgeAccountSnapshot[]
  schedules: PwaBridgeScheduleSnapshot[]
  currentPost: PwaBridgeCurrentPostSnapshot | null
}

export interface PwaBridgeLogSnapshot {
  id: number
  timestamp: number
  pageTabId: number
  accountId: number | null
  pageUid: string | null
  groupUid: string
  action: string
  result: string
  errorCode: string | null
  errorMessage: string | null
  publishedUrl: string | null
}

export interface PwaBridgeSnapshot {
  schemaVersion: typeof PWA_BRIDGE_SCHEMA_VERSION
  generatedAt: number
  staleAfterMs: number
  summary: PwaBridgeSummary
  pages: PwaBridgePageSnapshot[]
  recentLogs: PwaBridgeLogSnapshot[]
}

export interface PwaGroupPostCommand {
  schemaVersion: typeof PWA_REMOTE_COMMAND_SCHEMA_VERSION
  target: typeof PWA_REMOTE_COMMAND_TARGET
  commandId: string
  pageTabId: number
  action: PwaGroupPostCommandAction
  issuedAt: number
  expiresAt: number
}

export interface PwaGroupPostCommandResult {
  schemaVersion: typeof PWA_REMOTE_COMMAND_SCHEMA_VERSION
  commandId: string
  target: typeof PWA_REMOTE_COMMAND_TARGET
  pageTabId: number
  action: PwaGroupPostCommandAction
  ok: boolean
  code: PwaGroupPostCommandResultCode
  message: string | null
  handledAt: number
  fromStatus: RotationRuntimeStatus | null
  runtimeStatus: RotationRuntimeStatus | null
  runId: number | null
}

export interface PwaGroupPostCommandAck {
  result: PwaGroupPostCommandResult
  snapshot: PwaBridgeSnapshot
}

export function isPwaGroupPostCommand(value: unknown): value is PwaGroupPostCommand {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PwaGroupPostCommand>
  return candidate.schemaVersion === PWA_REMOTE_COMMAND_SCHEMA_VERSION
    && candidate.target === PWA_REMOTE_COMMAND_TARGET
    && typeof candidate.commandId === 'string'
    && PWA_REMOTE_COMMAND_ID_PATTERN.test(candidate.commandId)
    && typeof candidate.pageTabId === 'number'
    && Number.isInteger(candidate.pageTabId)
    && candidate.pageTabId > 0
    && typeof candidate.action === 'string'
    && (PWA_GROUP_POST_COMMAND_ACTIONS as readonly string[]).includes(candidate.action)
    && typeof candidate.issuedAt === 'number'
    && Number.isFinite(candidate.issuedAt)
    && typeof candidate.expiresAt === 'number'
    && Number.isFinite(candidate.expiresAt)
    && candidate.expiresAt > candidate.issuedAt
    && candidate.expiresAt - candidate.issuedAt <= PWA_REMOTE_COMMAND_MAX_TTL_MS
}
