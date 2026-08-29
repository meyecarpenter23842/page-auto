export const ACCOUNT_GROUP_IPC = {
  overview: 'account-groups:overview',
  create: 'account-groups:create',
  rename: 'account-groups:rename',
  delete: 'account-groups:delete',
  assign: 'account-groups:assign'
} as const

export interface AccountGroupRecord {
  id: number
  name: string
  accountCount: number
  createdAt: number
  updatedAt: number
}

export interface AccountGroupOverview {
  groups: AccountGroupRecord[]
  totalAccounts: number
  ungroupedCount: number
}

export interface CreateAccountGroupInput {
  name: string
}

export interface RenameAccountGroupInput {
  id: number
  name: string
}

export interface AccountGroupIdPayload {
  id: number
}

export interface AssignAccountsToGroupInput {
  accountIds: number[]
  groupId: number | null
}
