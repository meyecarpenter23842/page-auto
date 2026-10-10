import {
  cloneDefaultGroupWorkspaceDraft,
  parseGroupWorkspaceDraft,
  type GroupWorkspaceDraft
} from './groupWorkspaceConfig'

export interface PageJoinGroupWorkspaceConfig {
  pageTabId: number
  draft: GroupWorkspaceDraft
}

/** Page-bound Tham gia nhóm configs require an explicit ownership marker. */
export function parsePageJoinGroupWorkspaceConfig(configJson: string): PageJoinGroupWorkspaceConfig | null {
  let raw: unknown
  try {
    raw = JSON.parse(configJson)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (record.pageBusinessType !== 'join_group') return null
  const pageTabId = Number(record.pageTabId)
  if (!Number.isInteger(pageTabId) || pageTabId < 1) return null
  return { pageTabId, draft: parseGroupWorkspaceDraft(configJson) }
}

export function serializePageJoinGroupWorkspaceConfig(pageTabId: number, draft: GroupWorkspaceDraft): string {
  if (!Number.isInteger(pageTabId) || pageTabId < 1) throw new Error('Page Tab ID không hợp lệ.')
  return JSON.stringify({ ...draft, pageBusinessType: 'join_group', pageTabId })
}

export function createDefaultPageJoinGroupWorkspaceConfig(pageTabId: number): string {
  return serializePageJoinGroupWorkspaceConfig(pageTabId, cloneDefaultGroupWorkspaceDraft())
}
