import type { InteractionWorkspaceRunSnapshot } from './interactionWorkspaceRunner'

export const PAGE_JOIN_GROUP_RUNNER_IPC = {
  start: 'page-join-group-runner:start',
  status: 'page-join-group-runner:status',
  pause: 'page-join-group-runner:pause',
  resume: 'page-join-group-runner:resume',
  stop: 'page-join-group-runner:stop'
} as const

export interface PageJoinGroupRunIdPayload {
  bindingId: number
}

export type PageJoinGroupRunSnapshot = InteractionWorkspaceRunSnapshot
