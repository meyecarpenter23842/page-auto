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
    env: { ...process.env, PAGE_AUTO_DATA_DIR: dataDirectory, PAGE_AUTO_PWA_RELAY_DISABLED: '1' }
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
  for (const expected of ['Account / session hoặc Access Token', 'BỘ LỌC', 'KẾT QUẢ DATA-GRID', 'Lưu Dataset', 'Xuất CSV', 'Members / Privacy / Location là filter client-side trên metadata/text Facebook đã tải; không giả là filter server-side.']) {
    invariant(text.includes(expected), `Scanner UI thiếu contract: ${expected}.`)
  }
  invariant(!text.includes('mock foundation'), 'Quét Nhóm vẫn hiển thị nhãn mock foundation.')

  await root.getByRole('button', { name: 'Access Token', exact: true }).click()
  const tokenManager = root.locator('[data-testid="scanner-token-manager"]')
  await tokenManager.waitFor({ state: 'visible' })
  const secretInput = tokenManager.locator('[data-testid="scanner-token-secret"]')
  invariant(await secretInput.getAttribute('type') === 'password', 'Access Token input không được mask bằng password field.')
  const tokenText = await tokenManager.innerText()
  invariant(tokenText.includes('Quét bằng token:'), 'Token source thiếu trạng thái adapter production.')
  invariant(tokenText.includes('Tự lấy token từ phiên Facebook:'), 'Token source thiếu contract auto-acquire.')
  invariant(await root.getByRole('button', { name: 'Bắt đầu', exact: true }).isDisabled(), 'Scanner vẫn cho chạy adapter bằng token khi token business path chưa được audit.')
  invariant(await root.getByRole('button', { name: /Lấy token/i }).count() === 0, 'Scanner xuất hiện nút tự lấy token ngoài contract.')

  await root.getByRole('button', { name: 'Account/session', exact: true }).click()
  await root.getByRole('tab', { name: 'Quét Page', exact: true }).click()
  const pageText = await root.innerText()
  invariant(pageText.includes('Quét Page production đọc Page UID'), 'Tab Quét Page chưa hiển thị contract production Batch 4.')
  invariant(pageText.includes('Page UID') && pageText.includes('Followers') && pageText.includes('Likes'), 'Quét Page thiếu cột metadata production.')
  invariant(!pageText.includes('Quét Page vẫn dùng adapter foundation'), 'Quét Page vẫn hiển thị adapter foundation sau Batch 4.')
  invariant(await root.getByRole('button', { name: 'Bắt đầu', exact: true }).isDisabled(), 'Quét Page production phải yêu cầu Account khi DB smoke chưa có account.')

  await root.getByRole('tab', { name: 'Quét Người dùng', exact: true }).click()
  const userText = await root.innerText()
  invariant(userText.includes('Quét Người dùng production chỉ nhận UID hoặc URL Profile'), 'Tab Quét Người dùng chưa hiển thị contract production Batch 5A.')
  invariant(userText.includes('UID') && userText.includes('Username') && userText.includes('Followers'), 'Quét Người dùng thiếu cột metadata production.')
  invariant(!userText.includes('Quét Người dùng vẫn dùng adapter foundation'), 'Quét Người dùng vẫn hiển thị adapter foundation sau Batch 5A.')
  invariant(await root.getByRole('button', { name: 'Bắt đầu', exact: true }).isDisabled(), 'Quét Người dùng production phải yêu cầu Account khi DB smoke chưa có account.')

  await root.getByRole('tab', { name: 'Thành viên nhóm', exact: true }).click()
  const membersText = await root.innerText()
  invariant(membersText.includes('Thành viên nhóm production mở'), 'Tab Thành viên nhóm chưa hiển thị contract production Batch 5B.')
  invariant(membersText.includes('/user/') && membersText.includes('chống trùng UID'), 'Tab Thành viên nhóm thiếu identity/dedupe contract production.')
  invariant(await root.getByLabel('Group Dataset nguồn').count() === 1, 'Tab Thành viên nhóm thiếu Group Dataset source picker.')
  invariant(!membersText.includes('live audit DOM/member source'), 'Tab Thành viên nhóm vẫn hiển thị blocker cũ sau Batch 5B.')
  invariant(await root.getByRole('button', { name: 'Bắt đầu', exact: true }).isDisabled(), 'Thành viên nhóm production phải yêu cầu Account khi DB smoke chưa có account.')

  await root.getByRole('tab', { name: 'Quét Nhóm', exact: true }).click()
  await windowPage.screenshot({ path: screenshotPath, fullPage: true })
} finally {
  if (electronApp) await electronApp.close().catch(() => undefined)
  rmSync(dataDirectory, { recursive: true, force: true })
}
