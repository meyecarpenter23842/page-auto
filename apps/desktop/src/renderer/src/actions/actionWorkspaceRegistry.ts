import type { ActionWorkspaceType } from '../../../shared/actionWorkspaces'

export const ACTION_WORKSPACE_DEFINITIONS: ReadonlyArray<{
  id: ActionWorkspaceType
  label: string
  description: string
}> = [
  {
    id: 'interaction',
    label: 'Tương tác',
    description: 'Gom đối tượng + reaction/comment/reply/tag/chọc thành một workspace nghiệp vụ dùng các module nhỏ chung.'
  },
  {
    id: 'group',
    label: 'Nhóm',
    description: 'Workspace Nhóm theo kiểu data-grid: chọn account, nguồn Group ID, bộ lọc, pacing và chạy action Facebook thật.'
  }
]

export function getActionWorkspaceDefinition(type: ActionWorkspaceType) {
  return ACTION_WORKSPACE_DEFINITIONS.find((definition) => definition.id === type)
}
