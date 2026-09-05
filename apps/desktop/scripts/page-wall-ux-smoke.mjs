import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron')
const appDirectory = resolve(import.meta.dirname, '..')
const mainEntry = resolve(appDirectory, 'out/main/index.js')
const dataDirectory = mkdtempSync(resolve(tmpdir(), 'page-auto-wall-ux-'))
const layoutScreenshotPath = resolve(appDirectory, '../../dist/page-wall-ux-smoke.png')
const modalScreenshotPath = resolve(appDirectory, '../../dist/page-wall-schedule-smoke.png')
mkdirSync(dirname(layoutScreenshotPath), { recursive: true })

let electronApp
let windowPage

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function isNearWhite(value) {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value)
  if (!match) return false
  return Number(match[1]) > 235 && Number(match[2]) > 235 && Number(match[3]) > 235
}

try {
  electronApp = await electron.launch({
    executablePath: electronExecutable,
    args: [mainEntry],
    cwd: appDirectory,
    env: { ...process.env, PAGE_AUTO_DATA_DIR: dataDirectory }
  })

  windowPage = await electronApp.firstWindow()
  await windowPage.locator('.app-shell').waitFor({ state: 'visible', timeout: 30_000 })

  const setup = await windowPage.evaluate(async () => {
    const accountA = await window.pageAuto.createAccount({ uid: '700000001', name: 'Wall Smoke A', status: 'valid' })
    const accountB = await window.pageAuto.createAccount({ uid: '700000002', name: 'Wall Smoke B', status: 'valid' })
    const page = await window.pageAuto.createPageTab({ name: 'Wall Smoke Page', pageUid: '920000001' })

    const schedules = page.schedules.map((schedule) => ({
      dayOfWeek: schedule.dayOfWeek,
      startMinute: schedule.startMinute,
      endMinute: schedule.endMinute,
      enabled: schedule.enabled,
      sortOrder: schedule.sortOrder
    }))

    await window.pageAuto.updatePageTab({
      id: page.id,
      config: {
        name: page.name,
        pageUid: page.pageUid,
        rotation: page.rotation,
        accounts: [
          { accountId: accountA.id, enabled: true, sortOrder: 0, postsPerTurn: null },
          { accountId: accountB.id, enabled: true, sortOrder: 1, postsPerTurn: null }
        ],
        schedules,
        groupUids: page.groupUids,
        groupOrderMode: page.groupOrderMode,
        contentMode: page.contentMode,
        contents: page.contents,
        image: page.image
      }
    })

    await window.pageAuto.createContentLibraryItem({
      contentSetId: -1,
      name: 'Smoke Wall Post',
      enabled: true,
      variants: ['Nội dung smoke cho Đăng Tường'],
      image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
    })

    const bind = (type, label) => window.pageAuto.createActionWorkspace({
      type: 'interaction',
      label: `${page.name} · ${label}`,
      configJson: JSON.stringify({ pageBusinessType: type, pageTabId: page.id }),
      accounts: []
    })
    await bind('group_post', 'Đăng Nhóm')
    await bind('page_wall_post', 'Đăng Tường')

    return { pageId: page.id, accountA: accountA.id, accountB: accountB.id }
  })

  await windowPage.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await windowPage.getByRole('button', { name: 'Page Tabs' }).click()
  await windowPage.getByRole('tab', { name: /Đăng Tường/ }).click()

  const wallRoot = windowPage.locator('.business-page_wall_post')
  const accountsRegion = wallRoot.locator('[data-testid="page-wall-region-accounts"]')
  const contentRegion = wallRoot.locator('[data-testid="page-wall-region-content"]')
  const controlRegion = wallRoot.locator('[data-testid="page-wall-region-control"]')
  await accountsRegion.waitFor({ state: 'visible' })
  await contentRegion.waitFor({ state: 'visible' })
  await controlRegion.waitFor({ state: 'visible' })

  const geometry = await windowPage.evaluate(() => {
    const rect = (selector) => {
      const node = document.querySelector(selector)
      if (!node) return null
      const box = node.getBoundingClientRect()
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height }
    }
    return {
      accounts: rect('.business-page_wall_post [data-testid="page-wall-region-accounts"]'),
      content: rect('.business-page_wall_post [data-testid="page-wall-region-content"]'),
      control: rect('.business-page_wall_post [data-testid="page-wall-region-control"]')
    }
  })
  invariant(geometry.accounts && geometry.content && geometry.control, `Không đọc được layout Wall: ${JSON.stringify(geometry)}`)
  invariant(geometry.accounts.left < geometry.content.left - 20, `Tài khoản không nằm cột trái: ${JSON.stringify(geometry)}`)
  invariant(Math.abs(geometry.content.left - geometry.control.left) < 4, `Hai vùng phải không cùng cột: ${JSON.stringify(geometry)}`)
  invariant(geometry.content.bottom < geometry.control.top + 4, `Nội dung không nằm trên Lịch/Đăng ngay: ${JSON.stringify(geometry)}`)
  invariant(geometry.accounts.top <= geometry.content.top + 4 && geometry.accounts.bottom >= geometry.control.bottom - 4, `Tài khoản không full-height bên trái: ${JSON.stringify(geometry)}`)

  invariant(await wallRoot.locator('.page-wall-finite-head').isHidden(), 'Card header dư của Wall vẫn chiếm layout.')
  invariant(await wallRoot.locator('.page-wall-finite-footer').isHidden(), 'Footer kỹ thuật finite vẫn lộ ra UI.')

  const darkBackgrounds = await windowPage.evaluate(() => {
    const selectors = [
      '.business-page_wall_post [data-testid="page-wall-region-accounts"]',
      '.business-page_wall_post [data-testid="page-wall-region-content"]',
      '.business-page_wall_post [data-testid="page-wall-region-control"]',
      '.business-page_wall_post .page-wall-selected-post'
    ]
    return selectors.map((selector) => ({ selector, background: getComputedStyle(document.querySelector(selector)).backgroundColor }))
  })
  for (const entry of darkBackgrounds) {
    invariant(!isNearWhite(entry.background), `Dark theme còn surface trắng tại ${entry.selector}: ${entry.background}`)
  }

  const rows = wallRoot.locator('.page-wall-account-table tbody tr')
  await rows.first().waitFor({ state: 'visible' })
  invariant(await rows.count() === 2, `Wall smoke cần 2 account, thực tế ${await rows.count()}.`)

  await wallRoot.getByRole('button', { name: 'Bỏ chọn', exact: true }).first().click()
  const firstCheckbox = rows.nth(0).locator('input[type="checkbox"]')
  const secondCheckbox = rows.nth(1).locator('input[type="checkbox"]')
  invariant(!(await firstCheckbox.isChecked()) && !(await secondCheckbox.isChecked()), 'Bỏ chọn không bỏ hết account Wall.')

  await rows.nth(0).locator('td').nth(2).click()
  invariant(await firstCheckbox.isChecked(), 'Click dòng account Wall không chọn được account đầu tiên.')
  invariant(!(await secondCheckbox.isChecked()), 'Click dòng account Wall chọn nhầm account khác.')

  await secondCheckbox.click()
  invariant(await secondCheckbox.isChecked(), 'Click checkbox account Wall không chọn được account thứ hai.')
  const accountCount = await wallRoot.locator('[data-testid="page-wall-region-accounts"] .page-wall-region-head > span').innerText()
  invariant(accountCount.includes('2/2'), `Counter account Wall không phản ánh selection thật: ${accountCount}`)

  const chooseWorkspacePost = wallRoot.getByRole('button', { name: 'Chọn từ Thư viện', exact: true })
  await chooseWorkspacePost.click()
  let picker = windowPage.getByRole('dialog', { name: 'Chọn bài từ Thư viện' })
  await picker.waitFor({ state: 'visible' })
  const smokePost = picker.locator('article').filter({ hasText: 'Smoke Wall Post' })
  await smokePost.getByRole('button', { name: 'Chọn bài này' }).click()
  await picker.waitFor({ state: 'detached' })
  invariant((await wallRoot.locator('[data-testid="page-wall-selected-post"]').innerText()).includes('Smoke Wall Post'), 'Post Picker không set bài đang chọn ở Đăng ngay.')

  await wallRoot.locator('.page-wall-mode-tabs button').filter({ hasText: 'Lịch chạy' }).click()
  await wallRoot.locator('.page-wall-schedule-toolbar button').filter({ hasText: '+ Thêm lịch' }).click()

  let scheduleDialog = windowPage.getByRole('dialog', { name: 'Thiết lập lịch đăng' })
  await scheduleDialog.waitFor({ state: 'visible' })

  const modalGeometry = await scheduleDialog.evaluate((element) => {
    const box = element.getBoundingClientRect()
    return {
      left: box.left,
      top: box.top,
      right: box.right,
      bottom: box.bottom,
      centerX: box.left + box.width / 2,
      centerY: box.top + box.height / 2,
      viewportX: window.innerWidth / 2,
      viewportY: window.innerHeight / 2
    }
  })
  invariant(modalGeometry.left >= 8 && modalGeometry.top >= 8 && modalGeometry.right <= await windowPage.evaluate(() => innerWidth) - 8 && modalGeometry.bottom <= await windowPage.evaluate(() => innerHeight) - 8, `Popup lịch bị tràn màn hình: ${JSON.stringify(modalGeometry)}`)
  invariant(Math.abs(modalGeometry.centerX - modalGeometry.viewportX) < 90 && Math.abs(modalGeometry.centerY - modalGeometry.viewportY) < 90, `Popup lịch không đứng giữa màn hình: ${JSON.stringify(modalGeometry)}`)

  await scheduleDialog.getByRole('button', { name: 'Chọn', exact: true }).click()
  picker = windowPage.getByRole('dialog', { name: 'Chọn bài từ Thư viện' })
  await picker.waitFor({ state: 'visible' })
  const layers = await windowPage.evaluate(() => ({
    schedule: Number(getComputedStyle(document.querySelector('.page-wall-modal-backdrop.schedule')).zIndex || 0),
    picker: Number(getComputedStyle(document.querySelector('.page-wall-modal-backdrop.picker')).zIndex || 0)
  }))
  invariant(layers.picker > layers.schedule, `Post Picker của lịch vẫn nằm sau popup lịch: ${JSON.stringify(layers)}`)
  await picker.locator('article').filter({ hasText: 'Smoke Wall Post' }).getByRole('button', { name: 'Chọn bài này' }).click()
  await picker.waitFor({ state: 'detached' })
  scheduleDialog = windowPage.getByRole('dialog', { name: 'Thiết lập lịch đăng' })
  invariant((await scheduleDialog.innerText()).includes('Smoke Wall Post'), 'Chọn bài trong popup lịch không set lại schedule draft.')

  await scheduleDialog.getByRole('button', { name: 'Thêm', exact: true }).click()
  const editor = windowPage.getByRole('dialog', { name: 'Thêm bài viết' })
  await editor.waitFor({ state: 'visible' })
  const editorLayers = await windowPage.evaluate(() => ({
    schedule: Number(getComputedStyle(document.querySelector('.page-wall-modal-backdrop.schedule')).zIndex || 0),
    editor: Number(getComputedStyle(document.querySelector('.page-wall-modal-backdrop.editor')).zIndex || 0)
  }))
  invariant(editorLayers.editor > editorLayers.schedule, `Editor bài vẫn nằm sau popup lịch: ${JSON.stringify(editorLayers)}`)
  await editor.getByRole('button', { name: '×', exact: true }).click()
  await editor.waitFor({ state: 'detached' })

  scheduleDialog = windowPage.getByRole('dialog', { name: 'Thiết lập lịch đăng' })
  await scheduleDialog.getByRole('button', { name: '+ Thêm giờ', exact: true }).click()
  invariant(await scheduleDialog.locator('input[type="time"]').count() === 2, 'Thêm giờ trong popup lịch không thêm slot thứ hai.')

  await scheduleDialog.getByRole('button', { name: 'Bỏ chọn', exact: true }).click()
  const scheduleRows = scheduleDialog.locator('.page-wall-schedule-account-table tbody tr')
  await scheduleRows.nth(0).locator('td').nth(1).click()
  invariant(await scheduleRows.nth(0).locator('input[type="checkbox"]').isChecked(), 'Click dòng account trong popup lịch không chọn được.')

  await windowPage.screenshot({ path: modalScreenshotPath, fullPage: true })
  await scheduleDialog.getByRole('button', { name: 'Lưu lịch', exact: true }).click()
  await scheduleDialog.waitFor({ state: 'detached' })
  await wallRoot.locator('.page-wall-plan-row').first().waitFor({ state: 'visible' })
  const planText = await wallRoot.locator('.page-wall-plan-row').first().innerText()
  invariant(planText.includes('Smoke Wall Post') && planText.includes('1 TK'), `Lịch lưu xong không hiện đúng summary: ${planText}`)

  await windowPage.screenshot({ path: layoutScreenshotPath, fullPage: true })
  console.log('Page Wall UX smoke passed:', {
    pageId: setup.pageId,
    accountSelectionReal: true,
    layoutLeftPlusRightStack: true,
    darkThemeNoWhitePanels: true,
    scheduleChildModalsAboveParent: true,
    scheduleSaveWorks: true,
    layoutScreenshotPath,
    modalScreenshotPath
  })
} catch (error) {
  if (windowPage) {
    await windowPage.screenshot({ path: layoutScreenshotPath, fullPage: true }).catch(() => undefined)
  }
  throw error
} finally {
  if (electronApp) await electronApp.close().catch(() => undefined)
  rmSync(dataDirectory, { recursive: true, force: true })
}
