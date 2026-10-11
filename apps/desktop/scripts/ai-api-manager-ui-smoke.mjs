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

async function assertEditorLayout(page, label) {
  const g = await page.evaluate(() => {
    const pick = s => {
      const e = document.querySelector(s)
      if (!(e instanceof HTMLElement)) throw new Error('Missing element: '+s)
      return e
    }
    const rect = e => {
      const b=e.getBoundingClientRect()
      return {x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom}
    }
    const area=pick('.ai-results-canvas')
    const workspace=pick('.ai-results-workspace')
    const list=pick('.ai-draft-list')
    const cards=[...list.querySelectorAll('.ai-draft-row')]
    const editor=pick('.ai-draft-editor')
    const title=pick('.ai-draft-row-title strong')
    const input=pick('.ai-draft-editor-content textarea')
    return {
      area:rect(area),workspace:rect(workspace),list:rect(list),
      first:rect(cards[0]),second:rect(cards[1]),editor:rect(editor),title:rect(title),
      display:getComputedStyle(workspace).display,
      direction:getComputedStyle(workspace).flexDirection,
      cardDirection:getComputedStyle(list).flexDirection,
      truncation:getComputedStyle(title).textOverflow,
      nowrap:getComputedStyle(title).whiteSpace,
      textHeight:input.clientHeight,textScrollHeight:input.scrollHeight,textOverflow:getComputedStyle(input).overflowY
    }
  })
  assert(g.display==='flex' && g.direction==='column' && g.cardDirection==='row',
    label+': expected horizontal cards over the full-width editor '+JSON.stringify(g))
  assert(Math.abs(g.first.y-g.second.y)<=2 && g.second.x>g.first.x,
    label+': cards must form a single horizontal row '+JSON.stringify(g))
  assert(g.first.height<=64 && g.second.height<=64 && g.title.height<=21 &&
    g.nowrap==='nowrap' && g.truncation==='ellipsis',
    label+': card must show at most one text line '+JSON.stringify(g))
  assert(g.editor.y>=g.list.bottom && g.editor.y-g.list.bottom<=18,
    label+': editor is not directly below the cards '+JSON.stringify(g))
  assert(Math.abs(g.editor.x-g.workspace.x)<=3 && Math.abs(g.editor.width-g.workspace.width)<=3,
    label+': editor should fill the available width '+JSON.stringify(g))
  assert(g.editor.bottom>=g.area.bottom-22 && g.editor.height>=145,
    label+': editor should fill the available height '+JSON.stringify(g))
  assert(g.textHeight>=60 && g.textOverflow==='auto' && g.textScrollHeight>g.textHeight,
    label+': long article must scroll independently '+JSON.stringify(g))
  console.log('AI approved layout passed:',label,JSON.stringify(g))
}

try {
  const launched=await launch()
  app=launched.app
  let page=launched.page
  await toAi(page)
  await page.setViewportSize({width:1280,height:800})
  const divider = page.getByRole('separator',{name:'Độ rộng khung thiết lập AI'})
  await divider.waitFor({state:'visible'})
  const originalWidth = Number(await divider.getAttribute('aria-valuenow'))
  await divider.focus()
  await divider.press('ArrowRight')
  const resizedWidth = Number(await divider.getAttribute('aria-valuenow'))
  assert(resizedWidth === originalWidth + 20, 'AI composer keyboard divider must resize its sidebar')
  assert(await page.locator('.ai-extra-options').evaluate(node => !node.open),
    'Advanced AI controls should be collapsed by default')
  await page.locator('.ai-extra-options summary').click()
  assert(await page.locator('.ai-extra-options').evaluate(node => node.open),
    'Advanced AI controls must expand on demand')

  // Populate draft cards through the normal UI, without provider/API credits.
  await page.locator('.ai-count-field input').fill('2')
  await page.locator('.ai-agent-output-bridge summary').click()
  const postOne = ('Bài giới thiệu sản phẩm với thông tin rõ ràng, dễ đọc và được kiểm chứng. ').repeat(110)
  const postTwo = ('Bài hướng dẫn sử dụng sản phẩm, cách bảo quản và những lưu ý hữu ích. ').repeat(23)
  await page.locator('.ai-agent-output-body textarea').fill(postOne + '\n|\n' + postTwo)
  await page.locator('.ai-agent-output-body button').click()
  await page.locator('.ai-agent-output-bridge summary').click()
  assert(await page.locator('.ai-draft-row').count() === 2, 'Must produce two drafts from fixture')
  assert(await page.locator('.ai-draft-media-config').evaluate(el=>!el.open), 'Image settings must start collapsed')
  await page.getByRole('tab',{name:'Xem trước'}).click()
  assert(await page.locator('.ai-editor-plain-preview').isVisible(), 'Preview tab must display text')
  await page.getByRole('tab',{name:'Nội dung bài viết'}).click()
  assert(await page.locator('.ai-draft-editor-content textarea').isVisible(), 'Edit tab must restore textarea')
  for (const [width,height] of [[1280,720],[1366,768],[1600,900],[1920,1080],[1084,655]]) {
    await page.setViewportSize({width,height})
    await assertEditorLayout(page,width+'x'+height)
    if (width === 1280 || width === 1600) {
      await page.screenshot({path:resolve(appDirectory,'../../dist/ai-post-editor-'+width+'x'+height+'.png'),fullPage:true})
    }
  }
  await page.setViewportSize({width:1280,height:800})
  await page.setViewportSize({width:1084,height:655})
  const editorBounds = await page.locator('.ai-preview-panel').boundingBox()
  assert(editorBounds && editorBounds.width >= 480,
    'Result editor must remain usable at the compact Windows viewport: ' + JSON.stringify({
      editorBounds,
      layout: await page.locator('.ai-content-layout').boundingBox()
    }))
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
  const restoredWidth = Number(await page.getByRole('separator',{name:'Độ rộng khung thiết lập AI'}).getAttribute('aria-valuenow'))
  assert(restoredWidth === resizedWidth, 'AI sidebar width must survive Electron restart')
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
