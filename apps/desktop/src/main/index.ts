import './legacyIndex'
import { app } from 'electron'
import { join } from 'node:path'
import { initializeDatabase, type DatabaseRuntime } from './database'
import { registerPageWallFiniteRuntime, type PageWallFiniteRuntime } from './pageWallFiniteIpc'
import { prepareDataDirectory } from './services/dataDirectory'

let finiteDatabase: DatabaseRuntime | null = null
let finiteRuntime: PageWallFiniteRuntime | null = null

app.whenReady().then(() => {
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
})

app.on('before-quit', () => {
  finiteRuntime?.dispose()
  finiteRuntime = null
  finiteDatabase?.close()
  finiteDatabase = null
})
