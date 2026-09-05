import './legacyIndex'
import { app } from 'electron'
import { join } from 'node:path'
import { initializeDatabase, type DatabaseRuntime } from './database'
import { registerPageWallFiniteRuntime, type PageWallFiniteRuntime } from './pageWallFiniteIpc'
import { ensureDataDirectoryLayout, resolveDataDirectory } from './services/portablePaths'

let finiteDatabase: DatabaseRuntime | null = null
let finiteRuntime: PageWallFiniteRuntime | null = null

app.whenReady().then(() => {
  const dataDirectory = resolveDataDirectory({
    override: process.env.PAGE_AUTO_DATA_DIR,
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    userDataPath: app.getPath('userData')
  })
  ensureDataDirectoryLayout(dataDirectory)
  finiteDatabase = initializeDatabase(join(dataDirectory, 'page-auto.sqlite'))
  finiteRuntime = registerPageWallFiniteRuntime(finiteDatabase.client, dataDirectory)
})

app.on('before-quit', () => {
  finiteRuntime?.dispose()
  finiteRuntime = null
  finiteDatabase?.close()
  finiteDatabase = null
})
