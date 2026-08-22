import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { initializeDatabase, type DatabaseRuntime } from './database'
import { registerIpcHandlers } from './ipc'
import { createLogger } from './logger'

let mainWindow: BrowserWindow | null = null
let databaseRuntime: DatabaseRuntime | null = null

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#f4f7fb',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  window.once('ready-to-show', () => window.show())

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  window.on('closed', () => {
    mainWindow = null
  })

  return window
}

app.whenReady().then(() => {
  const dataDirectory = process.env.PAGE_AUTO_DATA_DIR ?? join(app.getPath('userData'), 'data')
  const logFile = join(dataDirectory, 'logs', 'app.log')
  const databaseFile = join(dataDirectory, 'page-auto.sqlite')
  const logger = createLogger(logFile)

  try {
    databaseRuntime = initializeDatabase(databaseFile)
    registerIpcHandlers()
    logger.info('Application initialized', { databaseFile })

    if (process.env.PAGE_AUTO_SMOKE_TEST === '1') {
      logger.info('Electron smoke test completed')
      app.quit()
      return
    }

    mainWindow = createMainWindow()
  } catch (error) {
    logger.error('Application initialization failed', {
      error: error instanceof Error ? error.message : String(error)
    })
    databaseRuntime?.close()
    databaseRuntime = null
    app.exit(1)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && process.env.PAGE_AUTO_SMOKE_TEST !== '1') {
      mainWindow = createMainWindow()
    }
  })
})

app.on('before-quit', () => {
  databaseRuntime?.close()
  databaseRuntime = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
