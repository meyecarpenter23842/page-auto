import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const appDirectory = resolve(import.meta.dirname, '..')
const executablePath = resolve(appDirectory, '../../dist/win-unpacked/PageAuto.exe')
const dataDirectory = mkdtempSync(resolve(tmpdir(), 'page-auto-proxy-builder-packaged-'))
const screenshotPath = resolve(appDirectory, '../../dist/proxy-builder-packaged-ui-smoke.png')
mkdirSync(dirname(screenshotPath), { recursive: true })

let electronApp
let server

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

async function listenAuthRejectProxy() {
  server = createServer((socket) => {
    socket.once('data', () => {
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="smoke"\r\nConnection: close\r\n\r\n')
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Smoke proxy did not bind a TCP port.')
  return address.port
}

try {
  invariant(existsSync(executablePath), `Packaged executable not found: ${executablePath}`)
  const proxyPort = await listenAuthRejectProxy()

  electronApp = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      PAGE_AUTO_DATA_DIR: dataDirectory,
      PAGE_AUTO_PWA_RELAY_DISABLED: '1'
    }
  })

  const page = await electronApp.firstWindow()
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30_000 })

  const menuButton = page.getByRole('button', { name: 'Proxy Builder', exact: true })
  await menuButton.waitFor({ state: 'visible' })
  await menuButton.click()

  const root = page.locator('[data-testid="proxy-builder-workspace"]')
  await root.waitFor({ state: 'visible', timeout: 15_000 })
  await root.getByRole('tab', { name: 'Tạo Proxy', exact: true }).waitFor({ state: 'visible' })
  await root.getByRole('tab', { name: 'Proxy Checker', exact: true }).click()

  const textarea = root.getByLabel('Danh sách proxy')
  await textarea.fill(`127.0.0.1:${proxyPort}`)
  const testButton = root.getByRole('button', { name: 'Test tất cả', exact: true })
  invariant(!(await testButton.isDisabled()), 'Packaged Proxy Checker Test tất cả vẫn bị disabled sau khi nhập proxy.')
  await testButton.click()

  const deadBadge = root.locator('.proxy-builder-live-badge.dead').filter({ hasText: 'DEAD' })
  await deadBadge.waitFor({ state: 'visible', timeout: 15_000 })
  const text = await root.innerText()
  invariant(text.includes('407'), 'Packaged checker không trả typed 407 error từ request thật qua proxy smoke.')
  invariant(text.includes('0 LIVE') && text.includes('1 DEAD'), 'Packaged checker summary không phản ánh LIVE/DEAD đúng.')

  await page.screenshot({ path: screenshotPath, fullPage: true })
  console.log('Proxy Builder packaged UI smoke passed:', { menuVisible: true, checkerIpcLive: true, deterministicDead: true, screenshotPath })
} finally {
  if (electronApp) await electronApp.close().catch(() => undefined)
  if (server) await new Promise((resolve) => server.close(() => resolve())).catch(() => undefined)
  rmSync(dataDirectory, { recursive: true, force: true })
}
