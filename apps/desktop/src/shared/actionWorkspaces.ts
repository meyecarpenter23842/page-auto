export const ACTION_WORKSPACE_TYPES = ['interaction', 'group', 'change_info'] as const
export type ActionWorkspaceType = (typeof ACTION_WORKSPACE_TYPES)[number]

export const ACTION_WORKSPACE_IPC = {
  list: 'action-workspaces:list',
  create: 'action-workspaces:create',
  update: 'action-workspaces:update',
  delete: 'action-workspaces:delete',
  presetList: 'action-workspaces:presets:list',
  presetSave: 'action-workspaces:presets:save',
  presetDelete: 'action-workspaces:presets:delete',
  pickTextFile: 'action-workspaces:data-source:pick-text-file',
  pickFolder: 'action-workspaces:data-source:pick-folder'
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

export interface ActionWorkspacePresetRecord {
  id: number
  type: ActionWorkspaceType
  name: string
  configJson: string
  createdAt: number
  updatedAt: number
}

export interface ActionWorkspacePresetListPayload {
  type: ActionWorkspaceType
}

export interface SaveActionWorkspacePresetInput {
  type: ActionWorkspaceType
  name: string
  configJson: string
}

export interface ActionWorkspacePresetIdPayload {
  id: number
}

export interface ActionWorkspacePresetApi {
  listPresets(payload: ActionWorkspacePresetListPayload): Promise<ActionWorkspacePresetRecord[]>
  savePreset(input: SaveActionWorkspacePresetInput): Promise<ActionWorkspacePresetRecord>
  deletePreset(payload: ActionWorkspacePresetIdPayload): Promise<boolean>
  pickTextFile(): Promise<string | null>
  pickFolder(): Promise<string | null>
}
