import { ACTION_REGISTRY, type ActionDefinition } from './actionRegistry'

let applied = false

export function applyCommonRuntimeActionOverrides(): void {
  if (applied) return
  const definition: ActionDefinition | undefined = ACTION_REGISTRY.find((item) => item.id === 'switch_page')
  if (definition) {
    definition.description = 'Chuyển session account sang Page UID của actor bằng Facebook Common Runtime và xác minh lại Page identity.'
    definition.runtimeStatus = 'ready'
  }
  applied = true
}
