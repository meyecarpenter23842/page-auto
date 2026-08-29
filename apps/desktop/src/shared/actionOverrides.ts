import type { ActionConfig } from './actionRegistry'
import { applyK41ActionOverrides, getK41FieldUiMeta, getK41ValidationErrors } from './k41ActionOverrides'
import { applyK42FriendActionOverrides, getK42FieldUiMeta, getK42ValidationErrors } from './k42FriendActionOverrides'
import { applyK431JoinGroupActionOverrides, getK431FieldUiMeta, getK431ValidationErrors } from './k431JoinGroupActionOverrides'
import { applyK432InviteFriendsGroupActionOverrides, getK432FieldUiMeta, getK432ValidationErrors } from './k432InviteFriendsGroupActionOverrides'
import { applyK433GroupInteractionActionOverrides, getK433FieldUiMeta, getK433ValidationErrors } from './k433GroupInteractionActionOverrides'
import { applyK434LeaveGroupActionOverrides, getK434FieldUiMeta, getK434ValidationErrors } from './k434LeaveGroupActionOverrides'
import { applyK435GroupPostActionOverrides, getK435FieldUiMeta, getK435ValidationErrors } from './k435GroupPostActionOverrides'
import { applyK452PostActionOverrides, getK452PostFieldUiMeta, getK452PostValidationErrors } from './k452PostActionOverrides'

export interface ActionFieldUiMeta {
  section: string
  multiline?: boolean
  rows?: number
  visibleWhen?: { key: string; equals: string | number | boolean }
  textFilePickerLabel?: string
  folderPickerLabel?: string
}

export function applyActionOverrides(): void {
  applyK41ActionOverrides()
  applyK42FriendActionOverrides()
  applyK431JoinGroupActionOverrides()
  applyK432InviteFriendsGroupActionOverrides()
  applyK433GroupInteractionActionOverrides()
  applyK434LeaveGroupActionOverrides()
  applyK435GroupPostActionOverrides()
  applyK452PostActionOverrides()
}

export function getActionFieldUiMeta(actionType: string, fieldKey: string): ActionFieldUiMeta | undefined {
  return getK452PostFieldUiMeta(actionType, fieldKey)
    ?? getK435FieldUiMeta(actionType, fieldKey)
    ?? getK434FieldUiMeta(actionType, fieldKey)
    ?? getK433FieldUiMeta(actionType, fieldKey)
    ?? getK432FieldUiMeta(actionType, fieldKey)
    ?? getK431FieldUiMeta(actionType, fieldKey)
    ?? getK42FieldUiMeta(actionType, fieldKey)
    ?? getK41FieldUiMeta(actionType, fieldKey)
}

export function getActionOverrideValidationErrors(actionType: string, config: ActionConfig): string[] {
  return [
    ...getK41ValidationErrors(actionType, config),
    ...getK42ValidationErrors(actionType, config),
    ...getK431ValidationErrors(actionType, config),
    ...getK432ValidationErrors(actionType, config),
    ...getK433ValidationErrors(actionType, config),
    ...getK434ValidationErrors(actionType, config),
    ...getK435ValidationErrors(actionType, config),
    ...getK452PostValidationErrors(actionType, config)
  ]
}
