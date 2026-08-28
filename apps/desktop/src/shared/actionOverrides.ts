import type { ActionConfig } from './actionRegistry'
import { applyK41ActionOverrides, getK41FieldUiMeta, getK41ValidationErrors } from './k41ActionOverrides'
import { applyK42FriendActionOverrides, getK42FieldUiMeta, getK42ValidationErrors } from './k42FriendActionOverrides'
import {
  applyK431JoinGroupActionOverrides,
  getK431FieldUiMeta,
  getK431ValidationErrors
} from './k431JoinGroupActionOverrides'

export interface ActionFieldUiMeta {
  section: string
  multiline?: boolean
  rows?: number
  visibleWhen?: { key: string; equals: string | number | boolean }
  textFilePickerLabel?: string
}

export function applyActionOverrides(): void {
  applyK41ActionOverrides()
  applyK42FriendActionOverrides()
  applyK431JoinGroupActionOverrides()
}

export function getActionFieldUiMeta(actionType: string, fieldKey: string): ActionFieldUiMeta | undefined {
  return getK431FieldUiMeta(actionType, fieldKey)
    ?? getK42FieldUiMeta(actionType, fieldKey)
    ?? getK41FieldUiMeta(actionType, fieldKey)
}

export function getActionOverrideValidationErrors(actionType: string, config: ActionConfig): string[] {
  return [
    ...getK41ValidationErrors(actionType, config),
    ...getK42ValidationErrors(actionType, config),
    ...getK431ValidationErrors(actionType, config)
  ]
}
