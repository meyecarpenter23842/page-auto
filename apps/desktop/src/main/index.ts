import './legacyIndex'
import { app } from 'electron'
import { join } from 'node:path'
import { registerAppUpdaterIpc, type AppUpdaterIpcRuntime } from './appUpdaterIpc'
import { initializeDatabase, type DatabaseRuntime } from './database'
import { registerPageWallFiniteRuntime, type PageWallFiniteRuntime } from './pageWallFiniteIpc'
import { prepareDataDirectory } from './services/dataDirectory'
import { registerZaloIpc, type ZaloIpcRuntime } from './zaloIpc'

let finiteDatabase: DatabaseRuntime | null = null
let finiteRuntime: PageWallFiniteRuntime | null = null
let updaterRuntime: AppUpdaterIpcRuntime | null = null
let zaloRuntime: ZaloIpcRuntime | null = null

app.whenReady().then(() => {
  updaterRuntime ??= registerAppUpdaterIpc()

  let dataDirectory: string
  try {
    dataDirectory = prepareDataDirectory({
      override: process.env.PAGE_AUTO_DATA_DIR,
      isPackaged: app.isPackaged,
      execPath: process.execPath,
      userDataPath: app.getPath('userData'),
      localAppDataPath: process.env.LOCALAPPDATA
    }).dataDirectory
  } catch (error) {
    console.error('Page Wall finite runtime data preparation failed', error instanceof Error ? error.message : String(error))
    return
  }

  finiteDatabase = initializeDatabase(join(dataDirectory, 'page-auto.sqlite'))
  finiteRuntime = registerPageWallFiniteRuntime(finiteDatabase.client, dataDirectory)
  zaloRuntime = registerZaloIpc(finiteDatabase.client, dataDirectory)
})

let shuttingDown = false

function disposeRemainingRuntimes(): void {
  updaterRuntime?.dispose()
  updaterRuntime = null
  finiteRuntime?.dispose()
  finiteRuntime = null
  finiteDatabase?.close()
  finiteDatabase = null
}

app.on('before-quit', (event) => {
  if (shuttingDown) return

  const runtime = zaloRuntime
  zaloRuntime = null
  if (!runtime) {
    disposeRemainingRuntimes()
    return
  }

  // Persistent Zalo profiles must close cleanly before Electron tears down utility
  // processes, otherwise Chromium may not flush session storage to userDataDir.
  event.preventDefault()
  shuttingDown = true
  void runtime.dispose()
    .catch((error) => {
      console.error('Zalo runtime graceful shutdown failed', error instanceof Error ? error.message : String(error))
    })
    .finally(() => {
      disposeRemainingRuntimes()
      app.quit()
    })
})