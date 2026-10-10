export const APP_UPDATER_IPC = {
  getState: 'app-updater:get-state',
  check: 'app-updater:check',
  install: 'app-updater:install',
  stateChanged: 'app-updater:state-changed'
} as const

export type AppUpdaterPhase =
  | 'idle'
  | 'unsupported'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'up_to_date'
  | 'updated'
  | 'error'

export interface AppUpdaterProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface AppUpdaterSnapshot {
  phase: AppUpdaterPhase
  currentVersion: string
  availableVersion: string | null
  previousVersion: string | null
  progress: AppUpdaterProgress | null
  message: string
  error: string | null
}

export interface AppUpdaterPendingMarker {
  fromVersion: string
  toVersion: string
  requestedAt: string
}

export interface AppUpdaterPostRestartResult {
  updated: boolean
  previousVersion: string | null
}

export function resolvePostRestartUpdate(currentVersion: string, marker: AppUpdaterPendingMarker | null): AppUpdaterPostRestartResult {
  if (!marker) return { updated: false, previousVersion: null }
  const updated = marker.toVersion === currentVersion && marker.fromVersion !== currentVersion
  return { updated, previousVersion: updated ? marker.fromVersion : null }
}
