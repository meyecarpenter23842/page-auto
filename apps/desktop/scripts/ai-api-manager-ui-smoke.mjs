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
  const modal=page.getByRole('dialog',{name:'Quản lý Agent'})
  await modal.waitFor({state:'visible'})
  assert(await modal.getByText('Kết nối Google Agent Builder').count() === 1,
    'Existing Google Agent Builder panel must remain')
  assert(await modal.getByRole('button',{name:/Tải danh sách Model/}).isDisabled(),
    'Do not call model API without a key')
  await modal.getByLabel('Tên kết nối').fill('API fixture')
  await modal.getByLabel('API Key').fill('fixture-do-not-use-as-a-real-secret')
  await modal.getByLabel('Nhập Model ID thủ công khi API không hỗ trợ liệt kê').check()
  await modal.getByLabel('Model ID dự phòng').fill('test/model')
  await modal.getByRole('button',{name:'Lưu kết nối'}).click()
  await modal.getByText('Đã lưu kết nối và model bằng mã hóa cục bộ.',{exact:false}).waitFor({state:'visible'})
  assert((await modal.getByLabel('API Key').inputValue())==='', 'Key should clear after saving')
  assert(!(await page.locator('body').innerText()).includes('fixture-do-not-use-as-a-real-secret'),
    'Secret must not appear in visible text')
  await page.setViewportSize({width:1280,height:800})
  await page.screenshot({path:screen,fullPage:true})
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
  const m=page.getByRole('dialog',{name:'Quản lý Agent'})
  page.once('dialog', dialog => void dialog.accept())
  await m.getByRole('button',{name:'Xóa API fixture'}).click()
  await page.waitForFunction(() => document.querySelector('.ai-api-empty')?.textContent?.includes('Chưa lưu API nào'))
  console.log('AI API manager smoke passed: save/select/restart/remove, no live provider requests.')
} finally {
  if (app) await app.close().catch(()=>undefined)
  rmSync(dataDirectory,{recursive:true,force:true})
}
