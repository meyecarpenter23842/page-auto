import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron')
const appDirectory = resolve(import.meta.dirname, '..')
const mainEntry = join(appDirectory, 'out', 'main', 'index.js')
const dataDirectory = mkdtempSync(join(tmpdir(), 'page-auto-page-business-ui-'))
const screenshotPath = resolve(appDirectory, '../../dist/page-business-ui-smoke.png')
mkdirSync(dirname(screenshotPath), { recursive: true })

let electronApp
let windowPage

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

async function tabText(selector) {
  return (await windowPage.locator(selector).allTextContents()).map((value) => value.trim()).filter(Boolean)
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

  const ids = await windowPage.evaluate(async () => {
    const pageA = await window.pageAuto.createPageTab({ name: 'Smoke Page A', pageUid: '910000001' })
    const pageB = await window.pageAuto.createPageTab({ name: 'Smoke Page B', pageUid: '910000002' })
    const pageC = await window.pageAuto.createPageTab({ name: 'Smoke Page C', pageUid: '910000003' })

    const bind = (page, type, label) => window.pageAuto.createActionWorkspace({
      type: 'interaction',
      label: `${page.name} · ${label}`,
      configJson: JSON.stringify({ pageBusinessType: type, pageTabId: page.id }),
      accounts: []
    })

    await bind(pageA, 'group_post', 'Đăng Nhóm')
    await bind(pageB, 'group_post', 'Đăng Nhóm')
    await bind(pageB, 'page_wall_post', 'Đăng Tường')
    await bind(pageA, 'page_edit', 'Sửa Page')
    await bind(pageC, 'run_scenario', 'Chạy kịch bản')

    await window.pageAuto.createActionWorkspace({
      type: 'group',
      label: `${pageA.name} · Tham gia nhóm`,
      configJson: JSON.stringify({ pageBusinessType: 'join_group', pageTabId: pageA.id, sourceMode: 'id_shared' }),
      accounts: []
    })

    await window.pageAuto.createActionWorkspace({
      type: 'interaction',
      label: 'Smoke Action thường',
      configJson: '{}',
      accounts: []
    })

    // Page created after all bindings must remain canonical-only until explicitly added.
    const pageD = await window.pageAuto.createPageTab({ name: 'Smoke Page D', pageUid: '910000004' })
    return { a: pageA.id, b: pageB.id, c: pageC.id, d: pageD.id }
  })

  await windowPage.getByRole('button', { name: 'Hành động' }).click()
  await windowPage.locator('.action-workspace-tab-list').waitFor({ state: 'visible' })
  const actionTabs = await windowPage.locator('.action-workspace-tab-list').innerText()
  invariant(actionTabs.includes('Smoke Action thường'), 'Hành động không render Action Workspace thường.')
  invariant(!actionTabs.includes('Smoke Page A'), 'Page-bound workspace vẫn lọt vào Hành động.')
  invariant(!actionTabs.includes('Smoke Page B'), 'Page-bound workspace của Page B vẫn lọt vào Hành động.')
  invariant(!actionTabs.includes('Tham gia nhóm'), 'Page-bound Tham gia nhóm vẫn lọt vào Hành động.')

  await windowPage.getByRole('button', { name: 'Page Tabs' }).click()
  await windowPage.locator('.page-business-group-pane .page-business-page-strip').waitFor({ state: 'visible' })

  const groupChips = await tabText('.page-business-group-pane .page-business-page-chip')
  invariant(groupChips.some((text) => text.includes('Smoke Page A')), 'Nhóm thiếu binding Page A.')
  invariant(groupChips.some((text) => text.includes('Smoke Page B')), 'Nhóm thiếu binding Page B.')
  invariant(!groupChips.some((text) => text.includes('Smoke Page D')), 'Page mới bị auto-bind vào Nhóm.')
  invariant(groupChips.length === 2, `Nhóm phải có đúng 2 binding, thực tế ${groupChips.length}.`)

  await windowPage.locator('.page-business-group-pane .pt-account-panel').waitFor({ state: 'visible' })
  await windowPage.locator('.page-business-group-pane .pt-business-panel').waitFor({ state: 'visible' })
  invariant(await windowPage.locator('.page-business-group-pane').getByText('Group Set', { exact: true }).count() > 0, 'UI Đăng Nhóm thiếu Group Set.')
  invariant(await windowPage.locator('.page-business-group-pane').getByText('Bài viết', { exact: true }).count() > 0, 'UI Đăng Nhóm thiếu Bài viết.')
  invariant((await windowPage.locator('.page-business-group-pane .page-tab-editor-header h2').innerText()).includes('Smoke Page A'), 'Nhóm không load config Page A ban đầu.')

  const pageBChip = windowPage.locator('.page-business-group-pane .page-business-page-chip').filter({ hasText: 'Smoke Page B' })
  await pageBChip.locator('button').first().click()
  await windowPage.locator('.page-business-group-pane .page-tab-editor-header h2').filter({ hasText: 'Smoke Page B' }).waitFor({ state: 'visible' })
  invariant((await windowPage.locator('.page-business-group-pane .page-tab-editor-header').innerText()).includes('910000002'), 'Đổi Page trong Nhóm không đổi đúng config/Page UID B.')

  await windowPage.getByRole('tab', { name: /Đăng Tường/ }).click()
  await windowPage.locator('.business-page_wall_post .page-business-page-chip').filter({ hasText: 'Smoke Page B' }).waitFor({ state: 'visible' })
  const wallChips = await tabText('.business-page_wall_post .page-business-page-chip')
  invariant(wallChips.length === 1 && wallChips[0].includes('Smoke Page B'), 'Đăng Tường không giữ binding độc lập Page B.')
  invariant(await windowPage.locator('.page-wall-target-card select').first().inputValue() === String(ids.b), 'Đăng Tường không nhận activePageId trực tiếp từ binding Page B.')

  await windowPage.getByRole('tab', { name: /Sửa Page/ }).click()
  await windowPage.locator('.business-page_edit .page-business-page-chip').filter({ hasText: 'Smoke Page A' }).waitFor({ state: 'visible' })
  const editChips = await tabText('.business-page_edit .page-business-page-chip')
  invariant(editChips.length === 1 && editChips[0].includes('Smoke Page A'), 'Sửa Page không giữ binding độc lập Page A.')

  await windowPage.getByRole('tab', { name: /Tham gia nhóm/ }).click()
  await windowPage.locator('.page-join-page-strip').waitFor({ state: 'visible' })
  await windowPage.locator('.page-join-page-chip').filter({ hasText: 'Smoke Page A' }).waitFor({ state: 'visible' })
  const joinChips = await tabText('.page-join-page-chip')
  invariant(joinChips.length === 1 && joinChips[0].includes('Smoke Page A'), 'Tham gia nhóm không giữ binding độc lập Page A.')

  await windowPage.getByRole('tab', { name: /Chạy kịch bản/ }).click()
  await windowPage.locator('.business-run_scenario .page-business-page-chip').filter({ hasText: 'Smoke Page C' }).waitFor({ state: 'visible' })
  const scenarioChips = await tabText('.business-run_scenario .page-business-page-chip')
  invariant(scenarioChips.length === 1 && scenarioChips[0].includes('Smoke Page C'), 'Chạy kịch bản không giữ binding độc lập Page C.')

  await windowPage.getByRole('tab', { name: /^Nhóm/ }).click()
  await windowPage.locator('.page-business-group-pane .page-business-page-chip').filter({ hasText: 'Smoke Page A' }).waitFor({ state: 'visible' })
  windowPage.once('dialog', (dialog) => void dialog.accept())
  const pageAChip = windowPage.locator('.page-business-group-pane .page-business-page-chip').filter({ hasText: 'Smoke Page A' })
  await pageAChip.locator('button.remove').click()
  await pageAChip.waitFor({ state: 'detached' })

  const canonicalAfterUnlink = await windowPage.evaluate(async (pageAId) => {
    const pages = await window.pageAuto.listPageTabs()
    return pages.some((page) => page.id === pageAId)
  }, ids.a)
  invariant(canonicalAfterUnlink, 'Unlink Nhóm đã xóa nhầm Page canonical A.')

  await windowPage.getByRole('tab', { name: /Sửa Page/ }).click()
  await windowPage.locator('.business-page_edit .page-business-page-chip').filter({ hasText: 'Smoke Page A' }).waitFor({ state: 'visible' })
  invariant((await tabText('.business-page_edit .page-business-page-chip')).some((text) => text.includes('Smoke Page A')), 'Unlink Nhóm làm mất binding độc lập của Sửa Page.')

  await windowPage.screenshot({ path: screenshotPath, fullPage: true })
  console.log('Page business UI smoke passed:', {
    actionWorkspaceClean: true,
    groupUiRendered: true,
    controlledPageSwitch: true,
    independentBindings: true,
    newPageNotAutoBound: true,
    unlinkKeepsCanonical: true,
    screenshotPath
  })
} catch (error) {
  if (windowPage) {
    await windowPage.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined)
  }
  throw error
} finally {
  if (electronApp) await electronApp.close().catch(() => undefined)
  rmSync(dataDirectory, { recursive: true, force: true })
}
