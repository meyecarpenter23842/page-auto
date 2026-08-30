import type {
  CanonicalPostSummary,
  PageTabImageConfig,
  PageTabPostBindingOverrides
} from './pageTabs'

export const SCENARIO_IPC = {
  list: 'scenarios:list',
  get: 'scenarios:get',
  create: 'scenarios:create',
  update: 'scenarios:update',
  delete: 'scenarios:delete',
  actionCreate: 'scenarios:actions:create',
  actionUpdate: 'scenarios:actions:update',
  actionDelete: 'scenarios:actions:delete',
  actionMove: 'scenarios:actions:move'
} as const

export const SCENARIO_ACTION_CATEGORIES = [
  'interaction',
  'friends',
  'groups',
  'marketplace',
  'publishing',
  'other'
] as const

export type ScenarioActionCategory = typeof SCENARIO_ACTION_CATEGORIES[number]

export interface ScenarioSummary {
  id: number
  name: string
  actionCount: number
  randomActionOrder: boolean
  runtimeLimitMinutes: number | null
  createdAt: number
  updatedAt: number
}

export interface ScenarioActionPostInput {
  /** Existing canonical post identity. Null/undefined creates a new canonical post. */
  postId?: number | null
  name: string
  enabled: boolean
  sortOrder: number
  variants: string[]
  image: PageTabImageConfig
}

export interface ScenarioActionPostItem extends Omit<ScenarioActionPostInput, 'postId'> {
  /** scenario_action_post_bindings.id */
  id: number
  postId: number
  canonical: CanonicalPostSummary
  overrides: PageTabPostBindingOverrides
}

export interface ScenarioActionRecord {
  id: number
  scenarioId: number
  actionType: string
  label: string
  category: ScenarioActionCategory
  orderIndex: number
  configJson: string
  enabled: boolean
  /** Canonical posts currently bound to this action. */
  posts?: ScenarioActionPostItem[]
  createdAt: number
  updatedAt: number
}

export interface ScenarioDetails extends ScenarioSummary {
  actions: ScenarioActionRecord[]
}

export interface CreateScenarioInput {
  name: string
  randomActionOrder?: boolean
  runtimeLimitMinutes?: number | null
}

export interface ScenarioIdPayload {
  id: number
}

export interface UpdateScenarioPayload {
  id: number
  patch: {
    name?: string
    randomActionOrder?: boolean
    runtimeLimitMinutes?: number | null
  }
}

export interface CreateScenarioActionInput {
  scenarioId: number
  actionType: string
  label: string
  category: ScenarioActionCategory
  enabled?: boolean
  configJson?: string
  /** When supplied, replaces the canonical post bindings for the new action in the same transaction. */
  posts?: ScenarioActionPostInput[]
}

export interface UpdateScenarioActionPayload {
  id: number
  patch: {
    actionType?: string
    label?: string
    category?: ScenarioActionCategory
    enabled?: boolean
    configJson?: string
  }
  /** When supplied, replaces canonical bindings. Omit to leave bindings unchanged. */
  posts?: ScenarioActionPostInput[]
}

export interface ScenarioActionIdPayload {
  id: number
}

export interface MoveScenarioActionPayload {
  scenarioId: number
  actionId: number
  direction: 'up' | 'down'
}

export const scenarioCategoryLabels: Record<ScenarioActionCategory, string> = {
  interaction: 'Tương tác',
  friends: 'Bạn bè',
  groups: 'Nhóm',
  marketplace: 'Marketplace',
  publishing: 'Đăng bài',
  other: 'Khác'
}
