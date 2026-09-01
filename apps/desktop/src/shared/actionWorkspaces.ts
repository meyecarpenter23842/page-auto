export const ACTION_WORKSPACE_TYPES = ['interaction', 'group'] as const
export type ActionWorkspaceType = (typeof ACTION_WORKSPACE_TYPES)[number]

export const ACTION_WORKSPACE_IPC = {
  list: 'action-workspaces:list',
  create: 'action-workspaces:create',
  update: 'action-workspaces:update',
  delete: 'action-workspaces:delete'
} as const

export interface ActionWorkspaceAccountBinding {
  accountId: number
  sortOrder: number
  enabled: boolean
}

export interface ActionWorkspaceRecord {
  id: number
  type: ActionWorkspaceType
  label: string
  configJson: string
  accounts: ActionWorkspaceAccountBinding[]
  createdAt: number
  updatedAt: number
}

export interface ActionWorkspaceAccountInput {
  accountId: number
  enabled: boolean
}

export interface CreateActionWorkspaceInput {
  type: ActionWorkspaceType
  label: string
  configJson: string
  accounts?: ActionWorkspaceAccountInput[]
}

export interface UpdateActionWorkspacePayload {
  id: number
  patch: {
    label?: string
    configJson?: string
    accounts?: ActionWorkspaceAccountInput[]
  }
}

export interface ActionWorkspaceIdPayload {
  id: number
}
