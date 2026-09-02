import type { ActionWorkspaceRecord } from './actionWorkspaces'
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

function isGenericType(value: unknown): value is GenericPageBusinessType {
  return value === 'group_post'
    || value === 'page_wall_post'
    || value === 'page_edit'
    || value === 'run_scenario'
}

export function parsePageBusinessBindingConfig(configJson: string): PageBusinessBindingConfig | null {
  let raw: unknown
  try {
    raw = JSON.parse(configJson)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const pageBusinessType = record.pageBusinessType
  const pageTabId = Number(record.pageTabId)
  if (!isGenericType(pageBusinessType) || !Number.isInteger(pageTabId) || pageTabId < 1) return null
  return { pageBusinessType, pageTabId }
}

export function serializePageBusinessBindingConfig(
  pageBusinessType: GenericPageBusinessType,
  pageTabId: number
): string {
  if (!Number.isInteger(pageTabId) || pageTabId < 1) throw new Error('Page Tab ID không hợp lệ.')
  return JSON.stringify({ pageBusinessType, pageTabId })
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
