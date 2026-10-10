import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const appDirectory = resolve(import.meta.dirname, '..')
const mainEntry = join(appDirectory, 'out', 'main', 'index.js')
const dataDirectory = mkdtempSync(join(tmpdir(), 'page-auto-r4c-ui-'))
const output = resolve(appDirectory, '../../dist')
mkdirSync(dirname(join(output, 'r4c-settings-1084x655.png')), { recursive: true })
let app

function invariant(ok, message) { if (!ok) throw new Error(message) }
const viewports = [
  { width: 1084, height: 655 }, { width: 1280, height: 800 },
  { width: 1366, height: 768 }, { width: 1920, height: 1080 }
]

try {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [mainEntry],
    cwd: appDirectory,
    env: { ...process.env, PAGE_AUTO_DATA_DIR: dataDirectory, PAGE_AUTO_PWA_RELAY_DISABLED: '1' }
  })
  const page = await app.firstWindow()
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('.sidebar-nav').getByRole('button', { name: 'Cài đặt', exact: true }).click()
  const settings = page.locator('.settings-shell')
  await settings.waitFor({ state: 'visible' })
  invariant(await settings.locator('.settings-menu-item').count() === 11, 'R4c: Settings must retain all 11 sections.')
  for (const { width, height } of viewports) {
    await page.setViewportSize({ width, height })
    const geometry = await settings.evaluate((root) => {
      const left = root.querySelector('.settings-menu')?.getBoundingClientRect()
      const right = root.querySelector('.settings-detail')?.getBoundingClientRect()
      return left && right ? { leftRight: left.right, rightLeft: right.left, rightRight: right.right, rootRight: root.getBoundingClientRect().right } : null
    })
    invariant(geometry && geometry.leftRight <= geometry.rightLeft + 3 && geometry.rightRight <= geometry.rootRight + 3,
      'R4c: Settings menu/detail overlap or overflow at ' + width + 'x' + height + ': ' + JSON.stringify(geometry))
    await page.screenshot({ path: join(output, 'r4c-settings-' + width + 'x' + height + '.png'), fullPage: true })
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await page.screenshot({ path: join(output, 'r4c-settings-dark.png'), fullPage: true })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await settings.getByRole('searchbox', { name: 'Tìm mục cài đặt' }).fill('không có mục 987654')
  invariant(await settings.locator('.settings-menu-empty').isVisible(), 'R4c: Settings empty search not shown.')
  await settings.getByRole('searchbox', { name: 'Tìm mục cài đặt' }).fill('')
  await page.locator('.sidebar-nav').getByRole('button', { name: 'Nhật ký', exact: true }).click()
  const logs = page.locator('.execution-logs-shell')
  await logs.waitFor({ state: 'visible' })
  invariant(await logs.locator('.execution-log-table-wrap').isVisible(), 'R4c: Logs table is not reachable.')
  for (const { width, height } of viewports) {
    await page.setViewportSize({ width, height })
    await page.screenshot({ path: join(output, 'r4c-logs-' + width + 'x' + height + '.png'), fullPage: true })
  }
  console.log('R4c Settings/Logs smoke passed (fixture UI, no runtime operations).')
} finally {
  if (app) await app.close().catch(() => undefined)
  rmSync(dataDirectory, { recursive: true, force: true })
}
