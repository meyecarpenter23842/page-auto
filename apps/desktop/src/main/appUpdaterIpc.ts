import { app, BrowserWindow, ipcMain } from 'electron'
import electronUpdater, { type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  APP_UPDATER_IPC,
  resolvePostRestartUpdate,
  type AppUpdaterPendingMarker,
  type AppUpdaterSnapshot
} from '../shared/appUpdater'

const { autoUpdater } = electronUpdater

export interface AppUpdaterIpcRuntime {
  getState: () => AppUpdaterSnapshot
  dispose: () => void
}

function updaterMarkerPath(): string {
  return join(app.getPath('userData'), 'page-auto-update-pending.json')
}

function readPendingMarker(): AppUpdaterPendingMarker | null {
  const path = updaterMarkerPath()
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<AppUpdaterPendingMarker>
    if (!parsed.fromVersion || !parsed.toVersion || !parsed.requestedAt) return null
    return {
      fromVersion: parsed.fromVersion,
      toVersion: parsed.toVersion,
      requestedAt: parsed.requestedAt
    }
  } catch {
    return null
  }
}

function clearPendingMarker(): void {
  rmSync(updaterMarkerPath(), { force: true })
}

function writePendingMarker(fromVersion: string, toVersion: string): void {
  const path = updaterMarkerPath()
  mkdirSync(dirname(path), { recursive: true })
  const marker: AppUpdaterPendingMarker = {
    fromVersion,
    toVersion,
    requestedAt: new Date().toISOString()
  }
  writeFileSync(path, JSON.stringify(marker, null, 2), 'utf8')
}

function initialState(): AppUpdaterSnapshot {
  const currentVersion = app.getVersion()
  if (!app.isPackaged) {
    return {
      phase: 'unsupported',
      currentVersion,
      availableVersion: null,
      previousVersion: null,
      progress: null,
      message: 'Cập nhật chỉ hoạt động trên bản PageAuto đã cài.',
      error: null
    }
  }

  const markerPath = updaterMarkerPath()
  const pending = readPendingMarker()
  if (existsSync(markerPath)) clearPendingMarker()
  const postRestart = resolvePostRestartUpdate(currentVersion, pending)
  if (postRestart.updated && postRestart.previousVersion) {
    return {
      phase: 'updated',
      currentVersion,
      availableVersion: null,
      previousVersion: postRestart.previousVersion,
      progress: null,
      message: `Đã cập nhật thành công từ v${postRestart.previousVersion} lên v${currentVersion}.`,
      error: null
    }
  }
  if (pending) {
    return {
      phase: 'idle',
      currentVersion,
      availableVersion: null,
      previousVersion: null,
      progress: null,
      message: 'Lần cập nhật trước chưa hoàn tất. Có thể kiểm tra lại bản cập nhật.',
      error: null
    }
  }

  return {
    phase: 'idle',
    currentVersion,
    availableVersion: null,
    previousVersion: null,
    progress: null,
    message: 'Sẵn sàng kiểm tra bản cập nhật.',
    error: null
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function registerAppUpdaterIpc(): AppUpdaterIpcRuntime {
  let state = initialState()
  let disposed = false

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false

  const broadcast = (): void => {
    if (disposed) return
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(APP_UPDATER_IPC.stateChanged, state)
    }
  }

  const patchState = (patch: Partial<AppUpdaterSnapshot>): AppUpdaterSnapshot => {
    state = { ...state, ...patch }
    broadcast()
    return state
  }

  const fail = (cause: unknown): AppUpdaterSnapshot => patchState({
    phase: 'error',
    progress: null,
    message: 'Không thể cập nhật PAGE-AUTO.',
    error: errorMessage(cause)
  })

  const onChecking = (): void => {
    patchState({
      phase: 'checking',
      availableVersion: null,
      progress: null,
      message: 'Đang kiểm tra bản cập nhật…',
      error: null
    })
  }

  const onAvailable = (info: UpdateInfo): void => {
    patchState({
      phase: 'available',
      availableVersion: info.version,
      progress: null,
      message: `Có bản mới v${info.version}. Đang chuẩn bị tải…`,
      error: null
    })
  }

  const onNotAvailable = (): void => {
    patchState({
      phase: 'up_to_date',
      availableVersion: null,
      progress: null,
      message: `PAGE-AUTO v${state.currentVersion} đang là bản mới nhất.`,
      error: null
    })
  }

  const onProgress = (progress: ProgressInfo): void => {
    patchState({
      phase: 'downloading',
      progress: {
        percent: Math.max(0, Math.min(100, progress.percent)),
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond
      },
      message: `Đang tải bản cập nhật${state.availableVersion ? ` v${state.availableVersion}` : ''}…`,
      error: null
    })
  }

  const onDownloaded = (info: UpdateInfo): void => {
    patchState({
      phase: 'ready',
      availableVersion: info.version,
      progress: state.progress ? { ...state.progress, percent: 100 } : null,
      message: `Bản v${info.version} đã tải xong. Sẵn sàng khởi động lại và cập nhật.`,
      error: null
    })
  }

  const onError = (error: Error): void => { fail(error) }

  autoUpdater.on('checking-for-update', onChecking)
  autoUpdater.on('update-available', onAvailable)
  autoUpdater.on('update-not-available', onNotAvailable)
  autoUpdater.on('download-progress', onProgress)
  autoUpdater.on('update-downloaded', onDownloaded)
  autoUpdater.on('error', onError)

  ipcMain.removeHandler(APP_UPDATER_IPC.getState)
  ipcMain.removeHandler(APP_UPDATER_IPC.check)
  ipcMain.removeHandler(APP_UPDATER_IPC.install)

  ipcMain.handle(APP_UPDATER_IPC.getState, () => state)
  ipcMain.handle(APP_UPDATER_IPC.check, async () => {
    if (!app.isPackaged) return state
    if (state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'installing' || state.phase === 'ready') return state

    try {
      patchState({
        phase: 'checking',
        availableVersion: null,
        progress: null,
        message: 'Đang kiểm tra bản cập nhật…',
        error: null
      })
      const result = await autoUpdater.checkForUpdates()
      if (result?.isUpdateAvailable) {
        patchState({
          phase: 'downloading',
          availableVersion: result.updateInfo.version,
          progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 },
          message: `Đang tải bản cập nhật v${result.updateInfo.version}…`,
          error: null
        })
        await autoUpdater.downloadUpdate()
      }
    } catch (cause) {
      fail(cause)
    }
    return state
  })

  ipcMain.handle(APP_UPDATER_IPC.install, () => {
    if (!app.isPackaged) return state
    if (state.phase !== 'ready' || !state.availableVersion) return state

    try {
      writePendingMarker(state.currentVersion, state.availableVersion)
      patchState({
        phase: 'installing',
        message: `Đang khởi động lại để cài v${state.availableVersion}…`,
        error: null
      })
      setTimeout(() => {
        try {
          autoUpdater.quitAndInstall(true, true)
        } catch (cause) {
          clearPendingMarker()
          fail(cause)
        }
      }, 100)
    } catch (cause) {
      clearPendingMarker()
      fail(cause)
    }
    return state
  })

  return {
    getState: () => state,
    dispose: () => {
      disposed = true
      ipcMain.removeHandler(APP_UPDATER_IPC.getState)
      ipcMain.removeHandler(APP_UPDATER_IPC.check)
      ipcMain.removeHandler(APP_UPDATER_IPC.install)
      autoUpdater.removeListener('checking-for-update', onChecking)
      autoUpdater.removeListener('update-available', onAvailable)
      autoUpdater.removeListener('update-not-available', onNotAvailable)
      autoUpdater.removeListener('download-progress', onProgress)
      autoUpdater.removeListener('update-downloaded', onDownloaded)
      autoUpdater.removeListener('error', onError)
    }
  }
}
