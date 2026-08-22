import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron')
const appDirectory = resolve(import.meta.dirname, '..')
const mainEntry = join(appDirectory, 'out', 'main', 'index.js')
const dataDirectory = mkdtempSync(join(tmpdir(), 'page-auto-electron-smoke-'))
const databaseFile = join(dataDirectory, 'page-auto.sqlite')

try {
  const result = spawnSync(electronExecutable, [mainEntry], {
    cwd: appDirectory,
    env: {
      ...process.env,
      PAGE_AUTO_SMOKE_TEST: '1',
      PAGE_AUTO_DATA_DIR: dataDirectory
    },
    encoding: 'utf8',
    timeout: 60_000
  })

  if (result.stdout) {
    process.stdout.write(result.stdout)
  }
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`Electron smoke process exited with status ${result.status}`)
  }
  if (!existsSync(databaseFile)) {
    throw new Error('Electron smoke test did not create the SQLite database')
  }

  console.log('Electron smoke test passed')
} finally {
  rmSync(dataDirectory, { recursive: true, force: true })
}
