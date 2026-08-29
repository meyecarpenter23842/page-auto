import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerAccountGroupIpcHandlers, type AccountGroupIpcRuntime } from './accountGroupIpc'
import { registerCheckpoint282WorkbenchIpcHandlers, type Checkpoint282WorkbenchIpcRuntime } from './checkpoint282WorkbenchIpc'
import { registerContentLibraryIpcHandlers, type ContentLibraryIpcRuntime } from './contentLibraryIpc'
import { initializeDatabase, type DatabaseRuntime } from './database'
import { registerHotmailIpcHandlers, type HotmailIpcRuntime } from './hotmailIpc'
import { registerIpcHandlers, type IpcRuntime } from './ipc'
import { createLogger } from './logger'
import { registerPostLibraryIpcHandlers, type PostLibraryIpcRuntime } from './postLibraryIpc'
import { registerScenarioIpcHandlers, type ScenarioIpcRuntime } from './scenarioIpc'
import { registerScenarioRunnerIpcHandlers, type ScenarioRunnerIpcRuntime } from './scenarioRunnerIpc'
import { ensureDataDirectoryLayout, resolveDataDirectory } from './services/portablePaths'

let mainWindow: BrowserWindow | null = null
let databaseRuntime: DatabaseRuntime | null = null
let ipcRuntime: IpcRuntime | null = null
let accountGroupIpcRuntime: AccountGroupIpcRuntime | null = null
let checkpoint282WorkbenchIpcRuntime: Checkpoint282WorkbenchIpcRuntime | null = null
let contentLibraryIpcRuntime: ContentLibraryIpcRuntime | null = null
let hotmailIpcRuntime: HotmailIpcRuntime | null = null
let postLibraryIpcRuntime: PostLibraryIpcRuntime | null = null
let scenarioIpcRuntime: ScenarioIpcRuntime | null = null
let scenarioRunnerIpcRuntime: ScenarioRunnerIpcRuntime | null = null

function resolveWindowIcon(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'app-icon.png')
    : join(__dirname, '../../resources/app-icon.png')
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#f4f7fb',
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  window.once('ready-to-show', () => window.show())

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) void window.loadURL(rendererUrl)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))

  window.on('closed', () => { mainWindow = null })
  return window
}

app.whenReady().then(() => {
  const dataDirectory = resolveDataDirectory({
    override: process.env.PAGE_AUTO_DATA_DIR,
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    userDataPath: app.getPath('userData')
  })
  ensureDataDirectoryLayout(dataDirectory)

  const logFile = join(dataDirectory, 'logs', 'app.log')
  const databaseFile = join(dataDirectory, 'page-auto.sqlite')
  const logger = createLogger(logFile)

  try {
    databaseRuntime = initializeDatabase(databaseFile)
    ipcRuntime = registerIpcHandlers({ database: databaseRuntime.client, dataDirectory })
    accountGroupIpcRuntime = registerAccountGroupIpcHandlers(databaseRuntime.client)
    contentLibraryIpcRuntime = registerContentLibraryIpcHandlers(databaseRuntime.client)
    checkpoint282WorkbenchIpcRuntime = registerCheckpoint282WorkbenchIpcHandlers({ database: databaseRuntime.client, dataDirectory })
    hotmailIpcRuntime = registerHotmailIpcHandlers(databaseRuntime.client)
    postLibraryIpcRuntime = registerPostLibraryIpcHandlers(databaseRuntime.client)
    scenarioIpcRuntime = registerScenarioIpcHandlers(databaseRuntime.client)
    scenarioRunnerIpcRuntime = registerScenarioRunnerIpcHandlers({ database: databaseRuntime.client, dataDirectory })
    logger.info('Application initialized', { databaseFile, dataDirectory, packaged: app.isPackaged, version: app.getVersion() })

    if (process.env.PAGE_AUTO_SMOKE_TEST === '1') {
      logger.info('Electron smoke test completed')
      app.quit()
      return
    }
    mainWindow = createMainWindow()
  } catch (error) {
    logger.error('Application initialization failed', { error: error instanceof Error ? error.message : String(error) })
    scenarioRunnerIpcRuntime?.dispose()
    scenarioRunnerIpcRuntime = null
    scenarioIpcRuntime?.dispose()
    scenarioIpcRuntime = null
    checkpoint282WorkbenchIpcRuntime?.dispose()
    checkpoint282WorkbenchIpcRuntime = null
    contentLibraryIpcRuntime?.dispose()
    contentLibraryIpcRuntime = null
    hotmailIpcRuntime?.dispose()
    hotmailIpcRuntime = null
    postLibraryIpcRuntime?.dispose()
    postLibraryIpcRuntime = null
    accountGroupIpcRuntime?.dispose()
    accountGroupIpcRuntime = null
    ipcRuntime?.dispose()
    ipcRuntime = null
    databaseRuntime?.close()
    databaseRuntime = null
    app.exit(1)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && process.env.PAGE_AUTO_SMOKE_TEST !== '1') mainWindow = createMainWindow()
  })
})

app.on('before-quit', () => {
  scenarioRunnerIpcRuntime?.dispose()
  scenarioRunnerIpcRuntime = null
  scenarioIpcRuntime?.dispose()
  scenarioIpcRuntime = null
  checkpoint282WorkbenchIpcRuntime?.dispose()
  checkpoint282WorkbenchIpcRuntime = null
  contentLibraryIpcRuntime?.dispose()
  contentLibraryIpcRuntime = null
  hotmailIpcRuntime?.dispose()
  hotmailIpcRuntime = null
  postLibraryIpcRuntime?.dispose()
  postLibraryIpcRuntime = null
  accountGroupIpcRuntime?.dispose()
  accountGroupIpcRuntime = null
  ipcRuntime?.dispose()
  ipcRuntime = null
  databaseRuntime?.close()
  databaseRuntime = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
