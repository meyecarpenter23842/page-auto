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

export interface ScenarioActionRecord {
  id: number
  scenarioId: number
  actionType: string
  label: string
  category: ScenarioActionCategory
  orderIndex: number
  configJson: string
  enabled: boolean
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
