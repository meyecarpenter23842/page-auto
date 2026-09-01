export const ACTION_WORKSPACE_DEFINITIONS = [
  {
    id: 'interaction',
    label: 'Tương tác',
    description: 'Gom đối tượng + reaction/comment/reply/tag/chọc thành một workspace nghiệp vụ dùng các module nhỏ chung.'
  }
] as const

export type ActionWorkspaceType = typeof ACTION_WORKSPACE_DEFINITIONS[number]['id']

export function getActionWorkspaceDefinition(type: ActionWorkspaceType) {
  return ACTION_WORKSPACE_DEFINITIONS.find((definition) => definition.id === type)
}
