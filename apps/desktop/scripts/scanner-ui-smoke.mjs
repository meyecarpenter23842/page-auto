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
  for (const expected of ['KẾT QUẢ DATA-GRID', 'Lưu Dataset', 'Xuất CSV', '0 tìm thấy · 0 đạt lọc · 0 đã chọn']) {
    invariant(text.includes(expected), `Scanner UI thiếu contract: ${expected}.`)
  }
  const sourceMode = root.getByRole('group', { name: 'Nguồn quét', exact: true })
  invariant(await sourceMode.count() === 1, 'Scanner thiếu nhóm chọn nguồn quét.')
  invariant(await sourceMode.getByRole('button', { name: 'Account/session', exact: true }).count() === 1, 'Scanner thiếu nguồn Account/session.')
  invariant(await sourceMode.getByRole('button', { name: 'Access Token', exact: true }).count() === 1, 'Scanner thiếu nguồn Access Token.')
  invariant(!text.includes('mock foundation'), 'Quét Nhóm vẫn hiển thị nhãn mock foundation.')
  invariant(await root.locator('.scanner-filter-card').count() === 0, 'Quét Nhóm vẫn đặt bộ lọc trong vùng cấu hình trước khi quét.')
  invariant(await root.locator('[data-testid="group-result-filters"]').count() === 0, 'Bộ lọc kết quả Quét Nhóm phải ẩn khi chưa có dữ liệu quét xong.')
  invariant(await root.getByLabel('Members tối thiểu').count() === 0, 'Members tối thiểu không được nằm trong bước Quét Nhóm ban đầu.')
  invariant(await root.getByLabel('Members tối đa').count() === 0, 'Members tối đa không được nằm trong bước Quét Nhóm ban đầu.')
  invariant(await root.getByLabel('Privacy').count() === 0, 'Privacy không được nằm trong bước Quét Nhóm ban đầu.')
  invariant(await root.getByLabel('Location').count() === 0, 'Location không được nằm trong bước Quét Nhóm ban đầu.')
  const selectAllEligible = root.getByRole('checkbox', { name: 'Chọn tất cả Group đạt bộ lọc', exact: true })
  invariant(await selectAllEligible.count() === 1, 'Quét Nhóm thiếu checkbox chọn tất cả Group đạt bộ lọc.')
  invariant(await selectAllEligible.isDisabled(), 'Checkbox chọn tất cả phải disabled khi chưa có Group đạt lọc.')

  await root.getByRole('button', { name: 'Access Token', exact: true }).click()
  const tokenManager = root.locator('[data-testid="scanner-token-manager"]')
  await tokenManager.waitFor({ state: 'visible' })
  const secretInput = tokenManager.locator('[data-testid="scanner-token-secret"]')
  invariant(await secretInput.getAttribute('type') === 'password', 'Access Token input không được mask bằng password field.')
  const tokenText = await tokenManager.innerText()
  invariant(tokenText.includes('Quét bằng token:'), 'Token source thiếu trạng thái adapter production.')
  invariant(tokenText.includes('Tự lấy token từ phiên Facebook:'), 'Token source thiếu contract auto-acquire.')
  invariant(await root.getByRole('button', { name: 'Quét', exact: true }).isDisabled(), 'Scanner vẫn cho chạy adapter bằng token khi token business path chưa được audit.')
  invariant(await root.getByRole('button', { name: /Lấy token/i }).count() === 0, 'Scanner xuất hiện nút tự lấy token ngoài contract.')

  await root.getByRole('button', { name: 'Account/session', exact: true }).click()
  await root.getByRole('tab', { name: 'Quét Page', exact: true }).click()
  const pageText = await root.innerText()
  invariant(pageText.includes('Page UID') && pageText.includes('Tên Page') && pageText.includes('Followers') && pageText.includes('Likes'), 'Quét Page thiếu cột metadata production.')
  invariant(pageText.includes('Metadata không xác minh được sẽ để trống, không đoán dữ liệu.'), 'Quét Page thiếu contract metadata không suy đoán.')
  invariant(!pageText.includes('Quét Page vẫn dùng adapter foundation'), 'Quét Page vẫn hiển thị adapter foundation sau Batch 4.')
  invariant(await root.getByRole('button', { name: 'Quét', exact: true }).isDisabled(), 'Quét Page production phải yêu cầu Account khi DB smoke chưa có account.')

  await root.getByRole('tab', { name: 'Quét Người dùng', exact: true }).click()
  const userText = await root.innerText()
  invariant(userText.includes('UID') && userText.includes('Tên') && userText.includes('Username') && userText.includes('Followers'), 'Quét Người dùng thiếu cột metadata production.')
  invariant(userText.includes('Metadata không xác minh được sẽ để trống, không đoán dữ liệu.'), 'Quét Người dùng thiếu contract metadata không suy đoán.')
  invariant(!userText.includes('Quét Người dùng vẫn dùng adapter foundation'), 'Quét Người dùng vẫn hiển thị adapter foundation sau Batch 5A.')
  invariant(await root.getByRole('button', { name: 'Quét', exact: true }).isDisabled(), 'Quét Người dùng production phải yêu cầu Account khi DB smoke chưa có account.')

  await root.getByRole('tab', { name: 'Thành viên nhóm', exact: true }).click()
  const membersText = await root.innerText()
  invariant(membersText.includes('UID') && membersText.includes('Tên thành viên') && membersText.includes('Group nguồn'), 'Thành viên nhóm thiếu cột production.')
  invariant(await root.getByLabel('Group Dataset nguồn').count() === 1, 'Tab Thành viên nhóm thiếu Group Dataset source picker.')
  invariant(!membersText.includes('live audit DOM/member source'), 'Tab Thành viên nhóm vẫn hiển thị blocker cũ sau Batch 5B.')
  invariant(await root.getByRole('button', { name: 'Quét', exact: true }).isDisabled(), 'Thành viên nhóm production phải yêu cầu Account khi DB smoke chưa có account.')

  await root.getByRole('tab', { name: 'Quét Nhóm', exact: true }).click()
  await windowPage.screenshot({ path: screenshotPath, fullPage: true })
} finally {
  if (electronApp) await electronApp.close().catch(() => undefined)
  rmSync(dataDirectory, { recursive: true, force: true })
}
