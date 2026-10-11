import { mkdirSync,mkdtempSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright-core'
const require=createRequire(import.meta.url)
const root=resolve(import.meta.dirname,'..')
const data=mkdtempSync(join(tmpdir(),'page-auto-ai-image-'))
mkdirSync(resolve(root,'../../dist'),{recursive:true})
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/qT8AAAAASUVORK5CYII='
let app
const assert=(condition,message)=>{if(!condition)throw new Error(message)}
try {
  app=await electron.launch({
    executablePath:require('electron'),args:[join(root,'out','main','index.js')],cwd:root,
    env:{...process.env,PAGE_AUTO_DATA_DIR:data,PAGE_AUTO_PWA_RELAY_DISABLED:'1'}
  })
  const page=await app.firstWindow()
  await page.locator('.app-shell').waitFor({state:'visible',timeout:30000})
  await page.locator('.sidebar-nav').getByRole('button',{name:'Thư viện',exact:true}).click()
  await page.getByRole('tab',{name:'Tạo ảnh AI'}).click()
  await page.locator('.ai-image-studio').waitFor({state:'visible'})
  // Only isolated Main IPC fixture handlers are replaced, never real provider credentials.
  await app.evaluate(({ipcMain})=>{
    const tiny='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/qT8AAAAASUVORK5CYII='
    const connection={id:'00000000-0000-4000-8000-000000000000',name:'Image test provider',
      provider:'openai-compatible',baseUrl:'https://api.openai.com/v1',modelId:'gpt-image-1',
      createdAt:0,isDefault:true}
    const nvidia={...connection,id:'00000000-0000-4000-8000-000000000001',name:'NVIDIA fixture',
      baseUrl:'https://integrate.api.nvidia.com/v1',modelId:'meta/llama-3.2-11b-vision-instruct',isDefault:false}
    for(const [key,callback] of [
      ['ai-api:list',()=>[connection,nvidia]],
      ['ai-api:discover',(_event,input)=>input.connectionId===nvidia.id
        ? [{id:'meta/llama-3.2-11b-vision-instruct',label:'Vision language model'},
           {id:'black-forest-labs/flux.2-klein-4b',label:'FLUX image model'}]
        : [{id:'gpt-image-1',label:'gpt-image-1'},
           {id:'plain/text-model',label:'Plain language model'},
           {id:'vendor/custom-model',label:'Unclassified model'}]],
      ['ai-image:pick-source',()=>({name:'product.png',dataUrl:tiny})],
      ['ai-image:choose-folder',()=> 'D:\\PageAuto\\AIImages'],
      ['ai-image:generate',(_event,input)=> {
        if(!input.prompt||!input.modelId||input.count<1||input.count>4)throw new Error('Invalid fixture generation request')
        if(input.mode==='product'&&(!input.source||!input.product))throw new Error('Missing product inputs')
        return Array.from({length:input.count},()=>({dataUrl:tiny,mimeType:'image/png'}))
      }],
      ['ai-image:save',(_event,input)=>input.images.map((x,index)=>'D:\\PageAuto\\AIImages\\image-'+index+'.png')]
    ]) {
      ipcMain.removeHandler(key)
      ipcMain.handle(key,callback)
    }
  })
  await page.setViewportSize({width:1600,height:900})
  await page.locator('.ai-image-control-pair button').first().click()
  await page.locator('#ai-image-connection').selectOption('00000000-0000-4000-8000-000000000000')
  assert(await page.locator('#ai-image-model').inputValue()==='', 'Image Studio must not auto-select the saved text model')
  await page.locator('#ai-image-prompt').fill('White canvas shoe in modern studio lighting')
  await page.getByRole('button',{name:/Tải model/}).click()
  const models=page.getByRole('combobox',{name:'Danh sách Model do API trả về'})
  await models.locator('option').nth(3).waitFor({state:'attached'})
  assert(await models.locator('option').count()===4, 'Show all 3 model IDs including text/unknown; plus placeholder')
  await page.locator('#ai-image-model').fill('vendor/manual-custom-id')
  assert(await page.locator('#ai-image-model').inputValue()==='vendor/manual-custom-id',
    'Manual Model ID must not be overwritten by the loaded list')
  await models.selectOption('gpt-image-1')
  assert(await page.locator('#ai-image-model').inputValue()==='gpt-image-1', 'User chooses the model explicitly')
  await page.getByRole('button',{name:/Ghép sản phẩm/}).click()
  await page.getByRole('button',{name:/Chọn ảnh từ máy/}).click()
  await page.getByRole('button',{name:/Chọn ảnh sản phẩm/}).click()
  await page.getByRole('button',{name:/Tạo 4 ảnh bằng AI/}).click()
  await page.locator('.ai-image-tile').first().waitFor({state:'visible'})
  assert(await page.locator('.ai-image-tile').count()===4,'Image gallery must contain 4 real img results')
  const geom=await page.evaluate(()=>{
    const panel=document.querySelector('.ai-image-settings').getBoundingClientRect()
    const gallery=document.querySelector('.ai-image-gallery-pane').getBoundingClientRect()
    const tiles=[...document.querySelectorAll('.ai-image-tile')].map(x=>x.getBoundingClientRect())
    return {panel:{x:panel.x,y:panel.y,w:panel.width,h:panel.height},
      gallery:{x:gallery.x,y:gallery.y,w:gallery.width,h:gallery.height},
      tiles:tiles.map(x=>({x:x.x,y:x.y,w:x.width,h:x.height}))}
  })
  assert(geom.gallery.x>geom.panel.x+geom.panel.w,'Gallery must appear to the right of settings')
  assert(geom.tiles[1].x>geom.tiles[0].x && Math.abs(geom.tiles[1].y-geom.tiles[0].y)<3,'Gallery must use 2-column cards')
  await page.screenshot({path:resolve(root,'../../dist/ai-image-studio-1600.png'),fullPage:true})
  await page.getByRole('button',{name:'Chọn thư mục…'}).click()
  await page.getByRole('button',{name:'Lưu 4 ảnh đã chọn'}).click()
  await page.getByRole('status').getByText(/Đã lưu 4 file ảnh thật/).waitFor({state:'visible'})
  await page.getByRole('button',{name:'Xem lớn ảnh 1'}).click()
  assert(await page.getByRole('dialog',{name:'Xem ảnh AI kích thước lớn'}).isVisible(),'Image preview must open')
  await page.getByRole('button',{name:'Đóng ×'}).click()
  await page.setViewportSize({width:1280,height:720})
  await page.screenshot({path:resolve(root,'../../dist/ai-image-studio-1280.png'),fullPage:true})
  // Integration: an unsaved article passes its current text to the image studio.
  // Once images are saved, the exact draft gets its canonical image folder.
  await page.getByRole('tab',{name:'Tạo bài bằng AI'}).click()
  await page.locator('.ai-agent-output-bridge summary').click()
  await page.locator('.ai-agent-output-body textarea').fill('Bài giới thiệu giày màu trắng, nền studio rõ nét.')
  await page.locator('.ai-agent-output-body button').click()
  await page.locator('.ai-agent-output-bridge summary').click()
  await page.getByRole('button',{name:'Tạo ảnh cho bài'}).click()
  await page.getByRole('tab',{name:'Tạo ảnh AI'}).waitFor({state:'visible'})
  assert((await page.locator('#ai-image-prompt').inputValue()).includes('giày màu trắng'),
    'AI image prompt must use the selected article content')
  await page.getByRole('button',{name:'Lưu & gắn vào bài'}).click()
  await page.locator('.ai-draft-media-config summary').click()
  const folder=await page.locator('.ai-media-folder-row input').inputValue()
  assert(folder==='D:\\PageAuto\\AIImages','Image folder must propagate back to the same draft: '+folder)
  assert(await page.getByRole('tab',{name:'Tạo bài bằng AI'}).getAttribute('aria-selected')==='true',
    'Saving/attaching returns to the article editor')
  console.log('AI image-to-article attachment passed:',folder)
  await page.getByRole('tab',{name:'Tạo ảnh AI'}).click()
  // NVIDIA: load exactly the API's models, including text models; never force FLUX.
  await page.locator('#ai-image-connection').selectOption('00000000-0000-4000-8000-000000000001')
  assert(await page.locator('#ai-image-model').inputValue()==='', 'Changing API must not silently pick a model')
  await page.getByRole('button',{name:/Tải model/}).click()
  const nvidiaModels=page.getByRole('combobox',{name:'Danh sách Model do API trả về'})
  await nvidiaModels.locator('option').nth(2).waitFor({state:'attached'})
  assert(await nvidiaModels.locator('option').count()===3, 'NVIDIA API model list must not be replaced with a FLUX whitelist')
  await nvidiaModels.selectOption('meta/llama-3.2-11b-vision-instruct')
  assert(await page.locator('#ai-image-model').inputValue()==='meta/llama-3.2-11b-vision-instruct',
    'The selected model must be exactly the NVIDIA model chosen by the user')
  assert(await page.getByRole('button',{name:/Tạo 4 ảnh bằng AI/}).isEnabled(),
    'Do not locally block user-selected NVIDIA model/mode; provider decides')
  await page.locator('#ai-image-model').fill('vendor/another-manual-model')
  assert(await page.getByRole('button',{name:/Tạo 4 ảnh bằng AI/}).isEnabled(),
    'Manual unknown model IDs must not be locally blocked')
  console.log('AI image studio model selection smoke passed')
  console.log('AI image studio Windows smoke passed:',JSON.stringify(geom))
} finally {
  await app?.close().catch(()=>undefined)
  rmSync(data,{recursive:true,force:true})
}
