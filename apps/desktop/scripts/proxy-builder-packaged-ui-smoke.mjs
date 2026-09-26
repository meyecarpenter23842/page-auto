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

  const menuButton = page.getByRole('button', { name: 'Proxy Center', exact: true })
  await menuButton.waitFor({ state: 'visible' })
  await menuButton.click()

  const root = page.locator('[data-testid="proxy-builder-workspace"]')
  await root.waitFor({ state: 'visible', timeout: 15_000 })
  await root.getByRole('tab', { name: 'Tạo Proxy', exact: true }).waitFor({ state: 'visible' })

  await root.getByRole('tab', { name: 'Kho Proxy', exact: true }).click()
  const createFolderButton = root.getByRole('button', { name: '+ Tạo', exact: true })
  await createFolderButton.click()
  const folderInput = root.getByLabel('Tên thư mục proxy')
  await folderInput.waitFor({ state: 'visible' })
  await folderInput.fill('Smoke Folder')
  await root.getByRole('button', { name: 'Lưu', exact: true }).click()
  await root.locator('.proxy-center-folders').getByText('Smoke Folder', { exact: true }).waitFor({ state: 'visible' })

  const inventoryInput = root.getByLabel('Nhập proxy vào kho')
  await inventoryInput.fill(`127.0.0.1:${proxyPort}:smoke1:secret1\n127.0.0.1:${proxyPort}:smoke2:secret2`)
  await root.getByRole('button', { name: 'Nhập vào kho (2)', exact: true }).click()
  const inventoryRows = root.locator('.proxy-center-table tbody tr')
  await inventoryRows.nth(1).waitFor({ state: 'visible' })

  const selectAllInventory = root.getByLabel('Chọn tất cả proxy đang lọc')
  await selectAllInventory.click()
  await root.getByText(/Đang tích 2 · phủ 0 · hiển thị 2\/2/).waitFor({ state: 'visible' })
  invariant(await root.isVisible(), 'Kho Proxy bị crash sau khi tích chọn tất cả.')

  const firstCell = inventoryRows.nth(0).locator('td').nth(1)
  const secondCell = inventoryRows.nth(1).locator('td').nth(1)
  const firstBox = await firstCell.boundingBox()
  const secondBox = await secondCell.boundingBox()
  invariant(firstBox && secondBox, 'Không đo được row để test phủ khối Kho Proxy.')
  await page.mouse.move(firstBox.x + 10, firstBox.y + firstBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(secondBox.x + 10, secondBox.y + secondBox.height / 2)
  await page.mouse.up()
  invariant(
    await root.locator('.proxy-center-table tbody tr.range-row').count() === 2,
    'Kho Proxy không phủ khối được bằng kéo chuột như Account Manager.'
  )

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
  console.log('Proxy Center packaged UI smoke passed:', { menuVisible: true, checkerIpcLive: true, deterministicDead: true, screenshotPath })
} finally {
  if (electronApp) await electronApp.close().catch(() => undefined)
  if (server) await new Promise((resolve) => server.close(() => resolve())).catch(() => undefined)
  rmSync(dataDirectory, { recursive: true, force: true })
}
