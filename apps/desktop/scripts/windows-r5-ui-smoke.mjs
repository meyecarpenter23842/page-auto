// R5 hermetic Windows renderer QA; no live profiles, network or automation actions.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, release, version } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const appDir = resolve(import.meta.dirname, '..')
const dataDir = mkdtempSync(join(tmpdir(), 'page-auto-r5-qa-'))
const output = resolve(appDir, '../../dist/r5-windows-ui')
mkdirSync(dirname(join(output, 'evidence.json')), { recursive: true })
const sizes = [[1280, 800], [1366, 768], [1920, 1080], [2560, 1440]]
const routes = [
  ['Tài khoản', 'Account Manager', '.account-manager'],
  ['Email', 'Email', '.email-shell'],
  ['Thư viện', 'Thư viện', '.content-library-hub'],
  ['Page Tabs', 'Page Tabs', '.page-business-workspace'],
  ['Hành động', 'Hành động', '.action-workspace'],
  ['Quét dữ liệu', 'Quét dữ liệu', '[data-testid="scanner-workspace"]'],
  ['Proxy Center', 'Proxy Center', '[data-testid="proxy-builder-workspace"]'],
  ['Zalo', 'Zalo', '.zalo-tool-shell'],
  ['Nhật ký', 'Runtime Logs', '.execution-logs-shell'],
  ['Cài đặt', 'Cài đặt', '.settings-shell']
]
const report = {
  kind: 'FIXTURE_CI_ONLY', os: { platform: process.platform, release: release(), version: version(), arch: process.arch },
  head: process.env.GITHUB_SHA || 'local', dpiVerified: false, liveSessionTested: false,
  viewportsAreSynthetic: true, screenshots: [], nativeWindow: null, restart: 'PENDING',
  errorCounts: { page: 0, console: 0 }
}
let app
function assert(ok, why) { if (!ok) throw new Error(why) }
async function launch() {
  const next = await electron.launch({
    executablePath: require('electron'), args: [join(appDir, 'out', 'main', 'index.js')],
    cwd: appDir, env: { ...process.env, PAGE_AUTO_DATA_DIR: dataDir, PAGE_AUTO_PWA_RELAY_DISABLED: '1' }
  })
  const page = await next.firstWindow()
  page.on('pageerror', () => { report.errorCounts.page++ })
  page.on('console', (msg) => { if (msg.type() === 'error') report.errorCounts.console++ })
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30000 })
  return { next, page }
}
async function openRoute(page, label, title, selector) {
  await page.locator('.sidebar-nav').getByRole('button', { name: label, exact: true }).click()
  await page.waitForFunction((name) =>
    document.querySelector('.sidebar-nav button[aria-current="page"] .nav-label')?.textContent?.trim() === name, label)
  // Some full-height workspaces intentionally hide the redundant app topbar.
  // Verify route identity in DOM and that actual workspace content is visible.
  await page.locator('main.workspace .topbar h1').filter({ hasText: title }).waitFor({ state: 'attached' })
  await page.locator(selector).waitFor({ state: 'visible', timeout: 15000 })
  assert(await page.locator('.sidebar-nav button[aria-current="page"]').count() === 1, 'R5: route selection ' + label)
}
async function capture(page, label, width, height, theme) {
  await page.setViewportSize({ width, height })
  await page.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
  const box = await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect()
    const workspace = document.querySelector('main.workspace')?.getBoundingClientRect()
    const header = document.querySelector('main.workspace .topbar')?.getBoundingClientRect()
    if (!sidebar || !workspace || !header) return null
    return { sidebarRight: sidebar.right, workspaceLeft: workspace.left, workspaceWidth: workspace.width,
      headerHeight: header.height, dpr: window.devicePixelRatio }
  })
  assert(box && box.workspaceWidth > 100, 'R5: missing workspace shell ' + label)
  assert(box.sidebarRight <= box.workspaceLeft + 4, 'R5: shell overlaps ' + label + ' ' + width)
  const file = 'r5-' + label.replace(/[^A-Za-z]+/g, '-').toLowerCase()
    + '-' + width + 'x' + height + '-' + theme + '.png'
  await page.screenshot({ path: join(output, file), fullPage: true })
  report.screenshots.push({ route: label, width, height, theme, file, bounds: box })
}
try {
  assert(process.platform === 'win32', 'R5 needs a Windows runner')
  let launched = await launch()
  app = launched.next
  let page = launched.page
  report.nativeWindow = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.isVisible())
    if (!win) return { found: false }
    const original = win.getBounds()
    win.restore()
    win.maximize()
    const maximized = win.isMaximized()
    win.restore()
    const restored = !win.isMaximized()
    win.setBounds(original)
    return { found: true, maximized, restored }
  })
  assert(report.nativeWindow.found && report.nativeWindow.maximized && report.nativeWindow.restored,
    'R5 native maximize/restore failed')
  for (const [label, title, selector] of routes) {
    await openRoute(page, label, title, selector)
    for (const [width, height] of sizes) await capture(page, label, width, height, 'light')
    await capture(page, label, 1280, 800, 'dark')
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  }
  await app.close()
  app = null
  launched = await launch()
  app = launched.next
  page = launched.page
  await page.waitForFunction(() =>
    document.querySelector('.sidebar-nav button[aria-current="page"] .nav-label')?.textContent?.trim() === 'Cài đặt')
  await page.locator('.settings-shell').waitFor({ state: 'visible' })
  report.restart = 'ROUTE_RESTORED_FIXTURE'
  assert(report.screenshots.length === 50, 'R5 incomplete screenshot matrix')
  console.log('R5 fixture QA passed: 50 screenshots, native maximize/restore and route restart')
} finally {
  writeFileSync(join(output, 'evidence.json'), JSON.stringify(report, null, 2))
  if (app) await app.close().catch(() => undefined)
  rmSync(dataDir, { recursive: true, force: true })
}
