import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron')
const appDirectory = resolve(import.meta.dirname, '..')
const mainEntry = join(appDirectory, 'out', 'main', 'index.js')
const dataDirectory = mkdtempSync(join(tmpdir(), 'page-auto-scanner-ui-'))
const screenshotPath = resolve(appDirectory, '../../dist/scanner-ui-smoke.png')
mkdirSync(dirname(screenshotPath), { recursive: true })

let electronApp

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
      PAGE_AUTO_DATA_DIR: dataDirectory,
      PAGE_AUTO_PWA_RELAY_DISABLED: '1'
    }
  })

  const windowPage = await electronApp.firstWindow()
  await windowPage.locator('.app-shell').waitFor({ state: 'visible', timeout: 30_000 })
  await windowPage.getByRole('button', { name: 'Quét dữ liệu', exact: true }).click()

  const root = windowPage.locator('[data-testid="scanner-workspace"]')
  await root.waitFor({ state: 'visible', timeout: 15_000 })
  for (const tab of ['Quét Nhóm', 'Quét Page', 'Quét Người dùng', 'Thành viên nhóm']) {
    await root.getByRole('tab', { name: tab, exact: true }).waitFor({ state: 'visible' })
  }

  const text = await root.innerText()
  for (const expected of [
    'Account / session Page-Auto',
    'BỘ LỌC',
    'KẾT QUẢ DATA-GRID',
    'Lưu Dataset',
    'Xuất CSV',
    'Members / Privacy / Location là filter client-side trên metadata/text Facebook đã tải; không giả là filter server-side.'
  ]) {
    invariant(text.includes(expected), `Scanner UI thiếu contract: ${expected}.`)
  }
  invariant(!text.includes('mock foundation'), 'Quét Nhóm vẫn hiển thị nhãn mock foundation.')

  await root.getByRole('tab', { name: 'Quét Page', exact: true }).click()
  invariant((await root.innerText()).includes('foundation'), 'Tab Quét Page chưa phân biệt rõ adapter chưa production.')

  await root.getByRole('tab', { name: 'Quét Nhóm', exact: true }).click()
  await windowPage.screenshot({ path: screenshotPath, fullPage: true })
} finally {
  if (electronApp) await electronApp.close().catch(() => undefined)
  rmSync(dataDirectory, { recursive: true, force: true })
}
