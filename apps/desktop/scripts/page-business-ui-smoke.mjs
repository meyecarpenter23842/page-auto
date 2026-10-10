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
const overviewScreenshotPath = resolve(appDirectory, '../../dist/page-overview-layout-smoke.png')
const overviewR1Screenshots = [
  { width: 1084, height: 655 },
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 }
]
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
  await windowPage.locator('.page-overview-table').waitFor({ state: 'visible' })
  await windowPage.locator('.page-overview-table tbody tr').filter({ hasText: 'Smoke Page A' }).waitFor({ state: 'visible' })
  await windowPage.locator('.page-overview-page-select').filter({ hasText: 'Smoke Page B' }).click()
  invariant((await windowPage.locator('.page-overview-detail').innerText()).includes('Smoke Page B'), 'Panel chi tiết chưa cập nhật theo Page được chọn.')
  invariant(await windowPage.locator('.page-overview-detail .page-overview-actions button').count() === 5, 'Thiếu điều khiển Page trong panel chi tiết.')

  // R1: the overview must show inventory + selected details side by side at
  // Windows desktop viewport sizes, not send the details below the fold.
  const originalViewport = windowPage.viewportSize() ?? await windowPage.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  for (const { width, height } of overviewR1Screenshots) {
    await windowPage.setViewportSize({ width, height })
    const rects = await windowPage.evaluate(() => {
      const table = document.querySelector('.page-overview-table-wrap')?.getBoundingClientRect()
      const detail = document.querySelector('.page-overview-detail')?.getBoundingClientRect()
      const root = document.querySelector('.page-overview')?.getBoundingClientRect()
      return root && table && detail ? {
        root: { top: root.top, bottom: root.bottom, right: root.right },
        table: { top: table.top, bottom: table.bottom, right: table.right, width: table.width },
        detail: { top: detail.top, bottom: detail.bottom, left: detail.left, right: detail.right, width: detail.width }
      } : null
    })
    invariant(rects !== null, 'R1: Thiếu vùng Tổng quan.')
    invariant(rects.table.width > 170 && rects.detail.width >= 280, 'R1: Hai vùng bị co/collapse ' + width + 'x' + height + ': ' + JSON.stringify(rects))
    invariant(Math.abs(rects.table.top - rects.detail.top) <= 3, 'R1: Panel bị đẩy xuống dưới bảng ' + width + 'x' + height + ': ' + JSON.stringify(rects))
    invariant(rects.table.right <= rects.detail.left + 3 && rects.detail.right <= rects.root.right + 3,
      'R1: Panel chồng/tràn ngoài Tổng quan ' + width + 'x' + height + ': ' + JSON.stringify(rects))
    invariant(rects.detail.bottom <= rects.root.bottom + 3 && rects.table.bottom <= rects.root.bottom + 3,
      'R1: Vùng vượt chiều cao Tổng quan ' + width + 'x' + height + ': ' + JSON.stringify(rects))
    await windowPage.screenshot({
      path: resolve(appDirectory, '../../dist/page-overview-r1-' + width + 'x' + height + '.png')
    })
  }

  // A true narrow window uses an explicit list/detail switch, not an unseen
  // detail block after a tall table.
  await windowPage.setViewportSize({ width: 840, height: 680 })
  await windowPage.getByRole('button', { name: 'Chi tiết Page →' }).click()
  invariant(await windowPage.locator('.page-overview-detail').isVisible(), 'R1: Chuyển sang chi tiết ở màn hình hẹp thất bại.')
  invariant(await windowPage.locator('.page-overview-table-wrap').isHidden(), 'R1: Bảng còn chiếm chỗ ở chế độ chi tiết hẹp.')
  await windowPage.getByRole('button', { name: '← Danh sách Page' }).click()
  invariant(await windowPage.locator('.page-overview-table-wrap').isVisible(), 'R1: Không trở lại danh sách Page ở màn hình hẹp.')
  await windowPage.setViewportSize(originalViewport)

  // Renderer reload emulates navigation recreation; selected Page remains
  // a UI preference and never updates Page config.
  await windowPage.reload()
  await windowPage.locator('.page-overview-detail-head h3').filter({ hasText: 'Smoke Page B' }).waitFor({ state: 'visible' })
  invariant((await windowPage.locator('.page-overview-page-select[aria-current="true"]').innerText()).includes('Smoke Page B'),
    'R1: Page được chọn không khôi phục sau renderer reload.')
  // R2: selection stays separate from active detail, persists across filters and
  // only targets visible IDs for select-all/clear-visible.
  await windowPage.getByRole('checkbox', { name: 'Chọn Page Smoke Page A' }).check()
  await windowPage.getByRole('checkbox', { name: 'Chọn Page Smoke Page B' }).check()
  invariant((await windowPage.locator('.page-overview-bulk').innerText()).includes('Đã chọn 2 Page'),
    'R2: Checkbox A/B không cập nhật số Page đang chọn.')
  const overviewSearch = windowPage.getByRole('searchbox', { name: 'Tìm Page/UID' })
  await overviewSearch.fill('Smoke Page A')
  invariant((await windowPage.locator('.page-overview-bulk').innerText()).includes('Đã chọn 2 Page'),
    'R2: Lọc bảng làm mất lựa chọn Page B đang ẩn.')
  await windowPage.getByRole('button', { name: 'Bỏ chọn đang lọc' }).click()
  invariant((await windowPage.locator('.page-overview-bulk').innerText()).includes('Đã chọn 1 Page'),
    'R2: Bỏ chọn đang lọc xóa cả lựa chọn ngoài filter.')
  await overviewSearch.fill('')
  invariant(await windowPage.getByRole('checkbox', { name: 'Chọn Page Smoke Page B' }).isChecked(),
    'R2: Page B ngoài bộ lọc bị bỏ chọn.')
  await windowPage.getByRole('button', { name: 'Bỏ chọn tất cả' }).click()
  await windowPage.locator('.page-overview-page-select').filter({ hasText: 'Smoke Page A' }).click({ modifiers: ['Control'] })
  await windowPage.locator('.page-overview-page-select').filter({ hasText: 'Smoke Page B' }).click({ modifiers: ['Shift'] })
  invariant((await windowPage.locator('.page-overview-bulk').innerText()).includes('Đã chọn 2 Page'),
    'R2: Ctrl/Shift không chọn đúng range Page A/B.')
  invariant(await windowPage.getByRole('button', { name: 'Start (2)' }).isEnabled(),
    'R2: Nút Start batch không hiển thị số Page đủ điều kiện.')
  invariant(await windowPage.getByRole('button', { name: 'Pause (0)' }).isDisabled(),
    'R2: Nút Pause không chặn Page đang idle.')
  await windowPage.getByRole('button', { name: 'Bỏ chọn tất cả' }).click()

  // R2: open exactly Page B's EXISTING Group schedule editor (not a new
  // store or runtime). Saving its schedule may not touch Page A.
  await windowPage.locator('.page-overview-page-select').filter({ hasText: 'Smoke Page B' }).click()
  const schedulesBefore = await windowPage.evaluate(async ({ a, b }) => {
    const [one, two] = await Promise.all([
      window.pageAuto.getPageTab({ id: a }), window.pageAuto.getPageTab({ id: b })
    ])
    return { a: one?.schedules ?? [], b: two?.schedules ?? [] }
  }, ids)
  await windowPage.getByRole('button', { name: 'Chỉnh lịch Page này' }).click()
  const r2ScheduleDialog = windowPage.getByRole('dialog', { name: 'Ngày và khung giờ' })
  await r2ScheduleDialog.waitFor({ state: 'visible' })
  invariant((await windowPage.locator('.page-business-group-pane .page-business-page-chip.active').innerText()).includes('Smoke Page B'),
    'R2: Chỉnh lịch từ Tổng quan mở nhầm Page khác.')
  await r2ScheduleDialog.getByRole('button', { name: '+ Khung giờ' }).click()
  await r2ScheduleDialog.getByRole('button', { name: 'Lưu lịch' }).click()
  await windowPage.waitForFunction(async ({ pageId, expectedCount }) => {
    const saved = await window.pageAuto.getPageTab({ id: pageId })
    return saved?.schedules.length === expectedCount
  }, { pageId: ids.b, expectedCount: schedulesBefore.b.length + 1 }, { timeout: 20_000 })
  const schedulesAfter = await windowPage.evaluate(async ({ a, b }) => {
    const [one, two] = await Promise.all([
      window.pageAuto.getPageTab({ id: a }), window.pageAuto.getPageTab({ id: b })
    ])
    return { a: one?.schedules ?? [], b: two?.schedules ?? [] }
  }, ids)
  invariant(JSON.stringify(schedulesAfter.a) === JSON.stringify(schedulesBefore.a),
    'R2: Chỉnh lịch B đã thay đổi lịch Page A.')
  invariant(schedulesAfter.b.length === schedulesBefore.b.length + 1,
    'R2: Editor cũ không lưu thêm khung lịch cho Page B.')
  await r2ScheduleDialog.getByRole('button', { name: 'Đóng', exact: true }).click()
  await windowPage.getByRole('tab', { name: /^Tổng quan/ }).click()
  await windowPage.locator('.page-overview-table').waitFor({ state: 'visible' })
  await windowPage.locator('.page-overview-page-select').filter({ hasText: 'Smoke Page B' }).click()

  await windowPage.screenshot({ path: overviewScreenshotPath, fullPage: true })
  await windowPage.getByRole('tab', { name: /^Nhóm/ }).click()
  await windowPage.locator('.page-business-group-pane .page-business-page-strip').waitFor({ state: 'visible' })
  // Binding chips mount before the async Page Tab editor; wait for the actual
  // account/config regions before measuring the R3 layout (fixes smoke race).
  await windowPage.locator('.page-business-group-pane .pt-account-panel-tall').waitFor({ state: 'visible' })
  await windowPage.locator('.page-business-group-pane .pt-compact-config-launchers').waitFor({ state: 'visible' })
  // R3 Group whole-screen evidence and geometry at supported desktop viewport sizes.
  for (const { width, height } of overviewR1Screenshots) {
    await windowPage.setViewportSize({ width, height })
    const layout = await windowPage.evaluate(() => {
      const root = document.querySelector('.page-business-group-pane')
      const account = root?.querySelector('.pt-account-panel-tall')
      const preview = root?.querySelector('.pt-live-preview')
      const config = root?.querySelector('.pt-compact-config-launchers')
      const controls = root?.querySelector('.page-tab-header-actions')
      if (!root || !account || !preview || !config || !controls) return null
      const rect = (element) => {
        const { left, top, right, bottom, width, height } = element.getBoundingClientRect()
        return { left, top, right, bottom, width, height }
      }
      return { account: rect(account), preview: rect(preview), config: rect(config), controls: rect(controls) }
    })
    invariant(layout !== null, 'R3: Missing Group layout regions at ' + width + 'x' + height)
    invariant(layout.account.height > 0 && layout.account.height <= height * 0.8,
      'R3: Account panel consumes unreasonable height: ' + JSON.stringify(layout))
    invariant(layout.preview.height > 0 && layout.preview.height <= height * 0.6,
      'R3: Idle preview consumes unreasonable height: ' + JSON.stringify(layout))
    invariant(layout.config.width > 0 && layout.controls.width > 0,
      'R3: Group config/controls collapsed: ' + JSON.stringify(layout))
    await windowPage.screenshot({
      path: resolve(appDirectory, '../../dist/page-group-r3-' + width + 'x' + height + '.png'),
      fullPage: true
    })
  }
  await windowPage.setViewportSize(originalViewport)
  // R2 validated B's schedule. Re-select the original baseline Page A for
  // the legacy Group interaction smoke, without changing the persisted
  // Overview selection (B is intentionally verified again after restart).
  await windowPage.locator('.page-business-group-pane .page-business-page-chip')
    .filter({ hasText: 'Smoke Page A' }).locator('button').first().click()
  await windowPage.locator('.page-business-group-pane .page-tab-editor-header h2')
    .filter({ hasText: 'Smoke Page A' }).waitFor({ state: 'visible' })

  const groupChips = await tabText('.page-business-group-pane .page-business-page-chip')
  invariant(groupChips.some((text) => text.includes('Smoke Page A')), 'Nhóm thiếu binding Page A.')
  invariant(groupChips.some((text) => text.includes('Smoke Page B')), 'Nhóm thiếu binding Page B.')
  invariant(!groupChips.some((text) => text.includes('Smoke Page D')), 'Page mới bị auto-bind vào Nhóm.')
  invariant(groupChips.length === 2, `Nhóm phải có đúng 2 binding, thực tế ${groupChips.length}.`)

  await windowPage.locator('.page-business-group-pane .pt-account-panel').waitFor({ state: 'visible' })
  await windowPage.locator('.page-business-group-pane .pt-compact-config-launchers').waitFor({ state: 'visible' })
  await windowPage.locator('.page-business-group-pane .pt-live-preview').waitFor({ state: 'visible' })

  const compactLabels = await tabText('.page-business-group-pane .pt-compact-config-actions button')
  for (const expected of ['Nhận diện', 'Lịch chạy', 'Group', 'Bài viết']) {
    invariant(compactLabels.some((label) => label.includes(expected)), `UI compact Nhóm thiếu nút ${expected}.`)
  }
  invariant(await windowPage.locator('.page-business-group-pane .pt-identity-panel').isHidden(), 'Card Nhận diện cũ vẫn chiếm layout Nhóm.')
  invariant(await windowPage.locator('.page-business-group-pane .pt-business-panel').isVisible(), 'Cấu hình Lịch/Group/Bài viết không hiển thị trong Nhóm.')
  const groupGeometry = await windowPage.evaluate(() => {
    const get = (selector) => document.querySelector(selector)?.getBoundingClientRect()
    const right = get('.page-business-group-pane .page-tab-right-pane')
    const launcher = get('.page-business-group-pane .pt-compact-config-launchers')
    const business = get('.page-business-group-pane .pt-business-panel')
    const preview = get('.page-business-group-pane .pt-live-preview')
    return right && launcher && business && preview ? {
      right: { x: right.x, right: right.right },
      launcher: { x: launcher.x, right: launcher.right, top: launcher.top, bottom: launcher.bottom },
      business: { top: business.top, bottom: business.bottom },
      preview: { top: preview.top }
    } : null
  })
  invariant(groupGeometry !== null, 'Thiếu vùng layout Nhóm để kiểm tra tọa độ.')
  invariant(groupGeometry.launcher.x >= groupGeometry.right.x - 2 && groupGeometry.launcher.right <= groupGeometry.right.right + 2, 'Nút cấu hình tràn khỏi cột bên phải.')
  invariant(groupGeometry.launcher.bottom <= groupGeometry.business.top + 2 && groupGeometry.business.bottom <= groupGeometry.preview.top + 2, 'Cấu hình và Preview chồng lấn nhau.')
  invariant(await windowPage.locator('.page-business-group-pane .pt-right-summary').isHidden(), 'Summary card cũ vẫn chiếm diện tích Preview.')

  const rotationInputWidth = await windowPage.locator('.page-business-group-pane .pt-rotation-grid input[type="number"]').first().evaluate((element) => element.getBoundingClientRect().width)
  invariant(rotationInputWidth <= 72, `Input Vòng chạy không còn compact (~3 chữ số): ${rotationInputWidth}px.`)

  await windowPage.getByRole('button', { name: 'Lịch chạy', exact: true }).click()
  const groupScheduleDialog = windowPage.getByRole('dialog', { name: 'Ngày và khung giờ' })
  await groupScheduleDialog.waitFor({ state: 'visible' })
  await groupScheduleDialog.getByRole('button', { name: 'Đóng', exact: true }).click()
  await groupScheduleDialog.waitFor({ state: 'detached' })

  await windowPage.getByRole('button', { name: 'Nhận diện', exact: true }).click()
  await windowPage.locator('.page-business-group-pane .pt-identity-panel.issue98-identity-modal').waitFor({ state: 'visible' })
  await windowPage.getByRole('button', { name: 'Đóng Nhận diện' }).click()
  await windowPage.locator('.page-business-group-pane .pt-identity-panel.issue98-identity-modal').waitFor({ state: 'hidden' })

  const groupLayout = await windowPage.evaluate(() => {
    const height = (selector) => document.querySelector(selector)?.getBoundingClientRect().height ?? 0
    return {
      pane: height('.page-business-group-pane'),
      scope: height('.page-business-group-pane .page-business-binding-scope'),
      content: height('.page-business-group-pane .page-business-binding-content'),
      child: height('.page-business-group-pane .page-business-scoped-child'),
      manager: height('.page-business-group-pane .page-tabs-manager'),
      workspace: height('.page-business-group-pane .page-tab-workspace'),
      preview: height('.page-business-group-pane .pt-live-preview')
    }
  })
  invariant(groupLayout.pane > 200, `Pane Nhóm có chiều cao bất thường: ${JSON.stringify(groupLayout)}`)
  invariant(groupLayout.scope >= groupLayout.pane - 2, `Binding scope Nhóm không fill pane: ${JSON.stringify(groupLayout)}`)
  invariant(groupLayout.content > Math.max(160, groupLayout.pane * 0.55), `Action Đăng Nhóm bị collapse sau thanh Page: ${JSON.stringify(groupLayout)}`)
  invariant(groupLayout.child >= groupLayout.content - 2, `Scoped child Nhóm không fill vùng action: ${JSON.stringify(groupLayout)}`)
  invariant(groupLayout.manager >= groupLayout.child - 2, `PageTabsManager không fill scoped child: ${JSON.stringify(groupLayout)}`)
  invariant(groupLayout.workspace > Math.max(120, groupLayout.content * 0.65), `Workspace Đăng Nhóm bị co về 0: ${JSON.stringify(groupLayout)}`)
  invariant(groupLayout.preview >= 110 && groupLayout.preview <= 225, `Preview chiếm quá nhiều không gian hoặc bị collapse: ${JSON.stringify(groupLayout)}`)

  invariant((await windowPage.locator('.page-business-group-pane .page-tab-editor-header h2').innerText()).includes('Smoke Page A'), 'Nhóm không load config Page A ban đầu.')

  const pageBChip = windowPage.locator('.page-business-group-pane .page-business-page-chip').filter({ hasText: 'Smoke Page B' })
  await pageBChip.locator('button').first().click()
  await windowPage.locator('.page-business-group-pane .page-tab-editor-header h2').filter({ hasText: 'Smoke Page B' }).waitFor({ state: 'visible' })
  invariant((await windowPage.locator('.page-business-group-pane .page-tab-editor-header').innerText()).includes('910000002'), 'Đổi Page trong Nhóm không đổi đúng config/Page UID B.')
  await windowPage.locator('.page-business-group-pane .pt-compact-config-launchers').waitFor({ state: 'visible' })

  await windowPage.getByRole('tab', { name: /Đăng Tường/ }).click()
  await windowPage.locator('.business-page_wall_post .page-business-page-chip').filter({ hasText: 'Smoke Page B' }).waitFor({ state: 'visible' })
  const wallChips = await tabText('.business-page_wall_post .page-business-page-chip')
  invariant(wallChips.length === 1 && wallChips[0].includes('Smoke Page B'), 'Đăng Tường không giữ binding độc lập Page B.')
  await windowPage.locator('.business-page_wall_post [data-testid="page-wall-three-regions"]').waitFor({ state: 'visible' })
  await windowPage.locator('.business-page_wall_post [data-testid="page-wall-region-accounts"]').waitFor({ state: 'visible' })
  await windowPage.locator('.business-page_wall_post [data-testid="page-wall-region-content"]').waitFor({ state: 'visible' })
  await windowPage.locator('.business-page_wall_post [data-testid="page-wall-region-control"]').waitFor({ state: 'visible' })
  invariant(await windowPage.locator('.business-page_wall_post .page-wall-common-frame').count() === 0, 'Đăng Tường vẫn render common-frame legacy.')
  invariant(await windowPage.locator('.business-page_wall_post .page-wall-group-layout').count() === 0, 'Đăng Tường vẫn render wrapper/group layout legacy.')

  const wallModeLabels = await tabText('.business-page_wall_post .page-wall-mode-tabs button')
  for (const expected of ['Đăng ngay', 'Lịch chạy']) {
    invariant(wallModeLabels.some((label) => label.includes(expected)), `Đăng Tường thiếu mode ${expected}.`)
  }
  invariant(!wallModeLabels.some((label) => label.includes('Hẹn 1 lần')), 'Đăng Tường vẫn còn mode Hẹn 1 lần.')

  const wallHeaderText = await windowPage.locator('.business-page_wall_post .page-wall-finite-head').innerText()
  invariant(wallHeaderText.includes('Smoke Page B') && wallHeaderText.includes('910000002'), 'Đăng Tường không nhận activePageId/Page UID B trực tiếp từ binding.')

  const accountControlsText = await windowPage.locator('.business-page_wall_post [data-testid="page-wall-account-controls"]').innerText()
  invariant(accountControlsText.includes('Chọn tất cả'), 'Đăng Tường thiếu Chọn tất cả.')
  invariant(accountControlsText.includes('Bỏ chọn'), 'Đăng Tường thiếu Bỏ chọn.')
  invariant(accountControlsText.includes('TK chạy song song'), 'Đăng Tường thiếu cấu hình TK chạy song song.')

  await windowPage.locator('.business-page_wall_post [data-testid="page-wall-selected-post"]').waitFor({ state: 'visible' })
  const postRegionText = await windowPage.locator('.business-page_wall_post [data-testid="page-wall-region-content"]').innerText()
  invariant(postRegionText.includes('Chọn từ Thư viện'), 'Đăng Tường thiếu thao tác chọn bài từ Thư viện.')
  invariant(postRegionText.includes('Thêm bài'), 'Đăng Tường thiếu thao tác thêm bài canonical.')
  invariant(postRegionText.includes('Sửa bài'), 'Đăng Tường thiếu thao tác sửa bài canonical.')
  invariant(postRegionText.includes('Bỏ chọn'), 'Đăng Tường thiếu thao tác bỏ bài đang chọn.')

  // R4b: validate real shared modal keyboard behavior without starting a post.
  const choosePostButton = windowPage.locator('.business-page_wall_post [data-testid="page-wall-selected-post"]').getByRole('button', { name: 'Chọn từ Thư viện' })
  await choosePostButton.click()
  const canonicalDialog = windowPage.getByRole('dialog', { name: 'Chọn bài cho Đăng Tường' })
  await canonicalDialog.waitFor({ state: 'visible' })
  invariant(await canonicalDialog.evaluate((dialog) => dialog.contains(document.activeElement)),
    'R4b: Canonical picker did not receive keyboard focus.')
  await windowPage.screenshot({
    path: resolve(appDirectory, '../../dist/canonical-post-picker-r4b.png'),
    fullPage: true
  })
  await windowPage.keyboard.press('Escape')
  await canonicalDialog.waitFor({ state: 'hidden' })
  await windowPage.waitForFunction(() => {
    const opener = document.querySelector('.business-page_wall_post [data-testid="page-wall-selected-post"] .page-wall-post-actions button')
    return document.activeElement === opener
  }, null, { timeout: 5000 })

  const nowPanelText = await windowPage.locator('.business-page_wall_post .page-wall-now-panel').innerText()
  invariant(nowPanelText.includes('Chạy đúng các TK đang tick'), 'Đăng ngay chưa mô tả chạy đúng TK đang tick.')
  invariant(nowPanelText.includes('Chưa chọn tài khoản') || nowPanelText.includes('Chưa chọn bài viết'), 'Đăng ngay không nói rõ lý do chưa thể chạy.')

  await windowPage.locator('.business-page_wall_post .page-wall-mode-tabs button').filter({ hasText: 'Lịch chạy' }).click()
  await windowPage.locator('.business-page_wall_post [data-testid="page-wall-plan-list"]').waitFor({ state: 'visible' })
  const schedulePanelText = await windowPage.locator('.business-page_wall_post .page-wall-schedule-panel').innerText()
  invariant(schedulePanelText.includes('+ Thêm lịch'), 'Lịch Tường thiếu nút Thêm lịch.')
  invariant(schedulePanelText.includes('Mỗi lịch tự giữ bộ bài + cách lấy bài + tài khoản + ngày chạy + giờ + concurrency.'), 'Lịch Tường chưa mô tả schedule self-contained.')
  invariant(!schedulePanelText.includes('Số task'), 'Lịch Tường vẫn lộ Số task kỹ thuật ra UI.')
  invariant(!schedulePanelText.includes('Lưu kế hoạch'), 'Lịch Tường vẫn còn editor kế hoạch inline cũ.')

  await windowPage.locator('.business-page_wall_post .page-wall-schedule-toolbar button').filter({ hasText: '+ Thêm lịch' }).click()
  const wallScheduleDialog = windowPage.getByRole('dialog', { name: 'Thiết lập lịch đăng' })
  await wallScheduleDialog.waitFor({ state: 'visible' })
  const wallScheduleText = await wallScheduleDialog.innerText()
  for (const expected of ['1. Bộ bài cho lịch', '2. Ngày và giờ đăng bài', '3. Chọn tài khoản muốn đăng', '+ Thêm giờ', 'TK song song']) {
    invariant(wallScheduleText.includes(expected), `Popup lịch Đăng Tường thiếu ${expected}.`)
  }
  await wallScheduleDialog.getByRole('button', { name: '×', exact: true }).click()
  await wallScheduleDialog.waitFor({ state: 'detached' })

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

  // Leave CI evidence on the UI this batch actually changes, with the complete schedule dialog visible.
  await windowPage.getByRole('tab', { name: /Đăng Tường/ }).click()
  await windowPage.locator('.business-page_wall_post .page-wall-mode-tabs button').filter({ hasText: 'Lịch chạy' }).click()
  await windowPage.locator('.business-page_wall_post .page-wall-schedule-toolbar button').filter({ hasText: '+ Thêm lịch' }).click()
  await windowPage.getByRole('dialog', { name: 'Thiết lập lịch đăng' }).waitFor({ state: 'visible' })
  await windowPage.screenshot({ path: screenshotPath, fullPage: true })

  // R1 end-to-end: restart Electron with the same disposable test data and
  // verify the selected Page survives a full process restart, not just reload.
  await electronApp.close()
  electronApp = await electron.launch({
    executablePath: electronExecutable,
    args: [mainEntry],
    cwd: appDirectory,
    env: { ...process.env, PAGE_AUTO_DATA_DIR: dataDirectory }
  })
  windowPage = await electronApp.firstWindow()
  await windowPage.locator('.app-shell').waitFor({ state: 'visible', timeout: 30_000 })
  if (!(await windowPage.locator('.page-overview-table').isVisible())) {
    await windowPage.getByRole('button', { name: 'Page Tabs' }).click()
  }
  await windowPage.locator('.page-overview-table').waitFor({ state: 'visible' })
  await windowPage.locator('.page-overview-page-select[aria-current="true"]')
    .filter({ hasText: 'Smoke Page B' }).waitFor({ state: 'visible' })
  await windowPage.locator('.page-overview-detail-head h3')
    .filter({ hasText: 'Smoke Page B' }).waitFor({ state: 'visible' })
  await windowPage.screenshot({
    path: resolve(appDirectory, '../../dist/page-overview-r1-restart.png'),
    fullPage: true
  })

  console.log('Page business UI smoke passed:', {
    actionWorkspaceClean: true,
    groupUiRendered: true,
    groupLayoutUsable: true,
    compactGroupUiRestored: true,
    controlledPageSwitch: true,
    independentBindings: true,
    wallNativeThreeRegions: true,
    wallAccountSelectionUi: true,
    wallCanonicalPostPicker: true,
    wallCompleteScheduleDialog: true,
    wallMultiTimeScheduleUi: true,
    newPageNotAutoBound: true,
    unlinkKeepsCanonical: true,
    screenshotPath,
    overviewScreenshotPath,
    fullRestartSelectionPreserved: true
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
