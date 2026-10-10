import {
  ACTION_WORKSPACE_TYPES,
  type ActionWorkspaceType
} from '../../shared/actionWorkspaces'
import { GROUP_JOIN_SOURCE_MODES } from '../../shared/groupWorkspaceConfig'
import { INTERACTION_TARGET_MODES } from '../../shared/interactionWorkspaceConfig'

const CANONICAL_TYPES = new Set<string>(ACTION_WORKSPACE_TYPES)
const GROUP_SOURCE_MODES = new Set<string>(GROUP_JOIN_SOURCE_MODES)
const INTERACTION_TARGETS = new Set<string>(INTERACTION_TARGET_MODES)
const PAGE_BUSINESS_BINDING_TYPES = new Set([
  'group_post',
  'page_wall_post',
  'page_edit',
  'run_scenario'
])

const LEGACY_TYPE_ALIASES: Record<string, ActionWorkspaceType> = {
  interaction_workspace: 'interaction',
  interactions: 'interaction',
  action_interaction: 'interaction',
  group_workspace: 'group',
  join_group: 'group',
  group_join: 'group',
  page_join_group: 'group',
  changeinfo: 'change_info',
  change_information: 'change_info',
  change_info_workspace: 'change_info',
  group_post: 'interaction',
  page_wall_post: 'interaction',
  page_edit: 'interaction',
  run_scenario: 'interaction',
  page_business: 'interaction'
}

function normalizedTypeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function configObject(configJson: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(configJson) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function positiveInteger(value: unknown): boolean {
  const normalized = Number(value)
  return Number.isInteger(normalized) && normalized > 0
}

function inferTypeFromConfig(configJson: string): ActionWorkspaceType | null {
  const config = configObject(configJson)
  if (!config) return null

  if (
    typeof config.pageBusinessType === 'string'
    && PAGE_BUSINESS_BINDING_TYPES.has(config.pageBusinessType)
    && positiveInteger(config.pageTabId)
  ) {
    return 'interaction'
  }

  const actions = objectValue(config.actions)
  if (
    actions
    && (
      (config.version === 1 && Array.isArray(config.actionOrder))
      || config.verifyAfterChange === true
      || Array.isArray(config.actionOrder)
    )
  ) {
    return 'change_info'
  }

  if (typeof config.sourceMode === 'string' && GROUP_SOURCE_MODES.has(config.sourceMode)) {
    return 'group'
  }

  if (
    (typeof config.targetMode === 'string' && INTERACTION_TARGETS.has(config.targetMode))
    || (actions && objectValue(config.reactions) !== null)
  ) {
    return 'interaction'
  }

  return null
}

export function normalizePersistedActionWorkspaceType(
  rawType: string,
  configJson: string
): ActionWorkspaceType | null {
  const token = normalizedTypeToken(rawType)
  if (CANONICAL_TYPES.has(token)) return token as ActionWorkspaceType

  const inferred = inferTypeFromConfig(configJson)
  if (inferred) return inferred

  return LEGACY_TYPE_ALIASES[token] ?? null
}
