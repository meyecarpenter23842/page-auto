import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron')
const appDirectory = resolve(import.meta.dirname, '..')
const mainEntry = join(appDirectory, 'out', 'main', 'index.js')
const dataDirectory = mkdtempSync(join(tmpdir(), 'page-auto-page-scenario-ui-'))
const screenshotPath = resolve(appDirectory, '../../dist/page-scenario-ui-smoke.png')
mkdirSync(dirname(screenshotPath), { recursive: true })

let electronApp
let windowPage

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

try {
  electronApp = await electron.launch({
    executablePath: electronExecutable,
    args: [mainEntry],
    cwd: appDirectory,
    env: {
      ...process.env,
      PAGE_AUTO_DATA_DIR: dataDirectory
    }
  })

  windowPage = await electronApp.firstWindow()
  await windowPage.locator('.app-shell').waitFor({ state: 'visible', timeout: 30_000 })

  await windowPage.evaluate(async () => {
    const page = await window.pageAuto.createPageTab({ name: 'Scenario Smoke Page', pageUid: '920000001' })
    await window.pageAuto.createActionWorkspace({
      type: 'interaction',
      label: `${page.name} · Chạy kịch bản`,
      configJson: JSON.stringify({ pageBusinessType: 'run_scenario', pageTabId: page.id }),
      accounts: []
    })
  })

  await windowPage.getByRole('button', { name: 'Page Tabs' }).click()
  await windowPage.getByRole('tab', { name: /Chạy kịch bản/ }).click()
  await windowPage.locator('.business-run_scenario .page-business-page-chip').filter({ hasText: 'Scenario Smoke Page' }).waitFor({ state: 'visible' })

  const root = windowPage.locator('.business-run_scenario [data-testid="page-scenario-workspace"]')
  await root.waitFor({ state: 'visible', timeout: 15_000 })
  await root.locator('[data-testid="page-scenario-three-regions"]').waitFor({ state: 'visible' })
  await root.locator('[data-testid="page-scenario-region-accounts"]').waitFor({ state: 'visible' })
  await root.locator('[data-testid="page-scenario-region-actions"]').waitFor({ state: 'visible' })
  await root.locator('[data-testid="page-scenario-region-control"]').waitFor({ state: 'visible' })

  const text = await root.innerText()
  for (const expected of ['Chọn tài khoản chạy', 'Kịch bản đang chọn', 'Chọn Kịch bản', 'Lịch chạy', '+ Thêm lịch']) {
    invariant(text.includes(expected), `Kịch bản Page thiếu UI ${expected}.`)
  }
  invariant(!text.includes('▶ Bắt đầu'), 'Kịch bản Page vẫn còn nút chạy ngay.')
  invariant(!text.includes('Đăng ngay'), 'Kịch bản Page vẫn còn mode Đăng ngay.')

  await root.getByRole('button', { name: '+ Thêm lịch', exact: true }).click()
  const dialog = windowPage.getByRole('dialog', { name: 'Thiết lập lịch Kịch bản Page' })
  await dialog.waitFor({ state: 'visible' })
  const dialogText = await dialog.innerText()
  for (const expected of ['1. Chọn hành động', '2. Thời gian chạy', '3. Chọn tài khoản muốn chạy', '+ Thêm giờ', 'TK song song']) {
    invariant(dialogText.includes(expected), `Popup lịch Kịch bản Page thiếu ${expected}.`)
  }

  await dialog.getByRole('button', { name: '×', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  await windowPage.screenshot({ path: screenshotPath, fullPage: true })
} finally {
  if (electronApp) await electronApp.close().catch(() => undefined)
  rmSync(dataDirectory, { recursive: true, force: true })
}
