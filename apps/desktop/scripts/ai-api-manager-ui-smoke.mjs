import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const appDirectory = resolve(import.meta.dirname, '..')
const mainEntry = join(appDirectory, 'out', 'main', 'index.js')
const dataDirectory = mkdtempSync(join(tmpdir(), 'page-auto-ai-api-smoke-'))
const screen = resolve(appDirectory,'../../dist/ai-api-manager-smoke.png')
mkdirSync(dirname(screen), { recursive:true })
let app
function assert(ok, message) { if (!ok) throw new Error(message) }
async function launch() {
  const next = await electron.launch({
    executablePath: require('electron'), args:[mainEntry], cwd:appDirectory,
    env:{...process.env,PAGE_AUTO_DATA_DIR:dataDirectory,PAGE_AUTO_PWA_RELAY_DISABLED:'1'}
  })
  const page = await next.firstWindow()
  await page.locator('.app-shell').waitFor({state:'visible',timeout:30000})
  return {app:next,page}
}
async function toAi(page) {
  await page.locator('.sidebar-nav').getByRole('button',{name:'Thư viện',exact:true}).click()
  await page.locator('.content-library-hub').getByRole('tab',{name:'Tạo bài bằng AI'}).click()
  await page.locator('.ai-content-workspace').waitFor({state:'visible'})
}
try {
  const launched=await launch()
  app=launched.app
  let page=launched.page
  await toAi(page)
  await page.getByRole('button',{name:/Quản lý AI/}).click()
  const modal=page.getByRole('dialog',{name:'Quản lý AI'})
  await modal.waitFor({state:'visible'})
  assert(await modal.getByText('Google Agent Builder').count() === 0,
    'Removed Google Agent Builder must never appear in AI manager')
  const legacyMethods = await page.evaluate(() => ({
    catalog: typeof window.pageAuto.getAiAgentCatalog,
    importJson: typeof window.pageAuto.importAiAgentJson
  }))
  assert(legacyMethods.catalog === 'undefined' && legacyMethods.importJson === 'undefined',
    'Removed Google Agent Builder preload API must not be exposed')
  // Electron's initial fixture window can be 1084x655. Set the QA viewport
  // before judging the modal size, and assert proportional screen utilization.
  await page.setViewportSize({width:1280,height:800})
  const geometry = await modal.boundingBox()
  const viewport = await page.evaluate(() => ({width:window.innerWidth,height:window.innerHeight}))
  assert(geometry && geometry.width >= viewport.width * 0.9
    && geometry.height >= viewport.height * 0.9,
    'AI manager must occupy at least 90% of the available viewport: ' + JSON.stringify({geometry, viewport}))
  assert(await modal.getByRole('button',{name:/Tải danh sách Model/}).isDisabled(),
    'Do not call model API without a key')
  await modal.getByLabel('Tên kết nối').fill('API fixture')
  await modal.getByLabel('API Key').fill('fixture-do-not-use-as-a-real-secret')
  await modal.getByLabel('Nhập Model ID thủ công khi API không hỗ trợ liệt kê').check()
  await modal.getByLabel('Model ID dự phòng').fill('test/model')
  assert(await modal.getByRole('button',{name:'Lưu kết nối'}).isDisabled(),
    'An unverified model must not be saved through the AI manager')
  await modal.getByLabel('Thời gian kiểm tra Model').selectOption('120000')
  // This fixture must never contact NVIDIA or consume an actual API quota.
  // Replace only the Main-process test handler for this isolated smoke run.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('ai-api:test')
    ipcMain.handle('ai-api:test', (_event, input) => input?.modelId === 'test/model')
  })
  await modal.getByRole('button',{name:'Kiểm tra Model', exact:true}).click()
  await modal.getByText('Model đã trả nội dung văn bản; có thể lưu kết nối.').waitFor({state:'visible'})
  assert(await modal.getByRole('button',{name:'Lưu kết nối'}).isEnabled(),
    'A successful text response must enable saving the verified model')
  await modal.getByRole('button',{name:'Lưu kết nối'}).click()
  await modal.getByText('Đã lưu kết nối và model bằng mã hóa cục bộ.',{exact:false}).waitFor({state:'visible'})
  assert((await modal.getByLabel('API Key').inputValue())==='', 'Key should clear after saving')
  assert(!(await page.locator('body').innerText()).includes('fixture-do-not-use-as-a-real-secret'),
    'Secret must not appear in visible text')
  await page.setViewportSize({width:1280,height:800})
  await page.screenshot({path:screen,fullPage:true})
  await page.setViewportSize({width:1084,height:655})
  const compact = await modal.boundingBox()
  assert(compact && compact.width <= 1084 && compact.height <= 655 && compact.width >= 1000,
    'AI manager must fit smaller Windows viewport: ' + JSON.stringify(compact))
  await page.setViewportSize({width:1280,height:800})
  await modal.getByRole('button',{name:'Đóng',exact:true}).last().click()
  assert(await page.getByRole('combobox',{name:'Chọn AI và Model'}).inputValue() !== '',
    'New API must be selectable in composer')
  const listed=await page.evaluate(() => window.pageAuto.listAiApiConnections())
  assert(listed.length===1 && listed[0].modelId==='test/model' && !JSON.stringify(listed).includes('fixture-do-not-use-as-a-real-secret'),
    'Catalog must contain only safe metadata')
  await app.close()
  app=null
  const restarted=await launch()
  app=restarted.app
  page=restarted.page
  await toAi(page)
  await page.waitForFunction(() => {
    const select = document.querySelector('select[aria-label="Chọn AI và Model"]')
    return select && select.value.startsWith('api:')
  })
  const selected=await page.getByRole('combobox',{name:'Chọn AI và Model'}).inputValue()
  assert(selected.startsWith('api:'),'Saved API model is not restored after app restart')
  await page.getByRole('button',{name:/Quản lý AI/}).click()
  const m=page.getByRole('dialog',{name:'Quản lý AI'})
  page.once('dialog', dialog => void dialog.accept())
  await m.getByRole('button',{name:'Xóa API fixture'}).click()
  await page.waitForFunction(() => document.querySelector('.ai-api-empty')?.textContent?.includes('Chưa lưu API nào'))
  console.log('AI API-only manager smoke passed: expanded responsive dialog, no Google legacy APIs, save/select/restart/remove, no live provider requests.')
} finally {
  if (app) await app.close().catch(()=>undefined)
  rmSync(dataDirectory,{recursive:true,force:true})
}
