import { useEffect, useMemo, useState } from 'react'
import type { AiApiConnectionView, AiApiModel } from '../../../shared/aiApiConnections'
import type { AiImageAsset, AiImageMode, AiImageOutput, AiImageSize } from '../../../shared/aiImages'
import './aiImageStudio.css'

type GalleryImage = AiImageOutput & { id: string; name: string; selected: boolean }
type Busy = 'loading' | 'models' | 'source' | 'product' | 'folder' | 'generate' | 'save' | null
const modes: { id: AiImageMode; label: string; description: string; icon: string }[] = [
  {id:'new',label:'Tạo ảnh mới',description:'Từ mô tả',icon:'✦'},
  {id:'background',label:'Từ ảnh nền',description:'Dùng ảnh nền sẵn',icon:'▧'},
  {id:'product',label:'Ghép sản phẩm',description:'Ảnh nền + ảnh sản phẩm',icon:'◈'},
  {id:'edit',label:'Chỉnh sửa ảnh',description:'Thay đổi ảnh gốc',icon:'✎'}
]
const sizes: { value: AiImageSize; label: string }[] = [
  {value:'1024x1024',label:'1:1 — 1024 × 1024'},
  {value:'1536x1024',label:'3:2 — 1536 × 1024'},
  {value:'1024x1536',label:'2:3 — 1024 × 1536'}
]
function explain(error: unknown): string {
  return (error instanceof Error ? error.message : 'Không thực hiện được tác vụ ảnh.')
    .replace(/^Error invoking remote method '[^']+': Error: /,'')
}

export function AiImageStudio() {
  const [connections,setConnections] = useState<AiApiConnectionView[]>([])
  const [connectionId,setConnectionId] = useState('')
  const [models,setModels] = useState<AiApiModel[]>([])
  const [modelId,setModelId] = useState('')
  const [mode,setMode] = useState<AiImageMode>('new')
  const [prompt,setPrompt] = useState('')
  const [source,setSource] = useState<AiImageAsset | null>(null)
  const [product,setProduct] = useState<AiImageAsset | null>(null)
  const [size,setSize] = useState<AiImageSize>('1024x1024')
  const [count,setCount] = useState(4)
  const [filePrefix,setFilePrefix] = useState('anh-ai')
  const [folder,setFolder] = useState('')
  const [images,setImages] = useState<GalleryImage[]>([])
  const [viewer,setViewer] = useState<string | null>(null)
  const [busy,setBusy] = useState<Busy>(null)
  const [message,setMessage] = useState('')
  const [error,setError] = useState('')
  const current = useMemo(()=>connections.find(c=>c.id===connectionId),[connections,connectionId])
  const selected = useMemo(()=>images.filter(item=>item.selected),[images])
  const refreshConnections = async () => {
    setBusy('loading');setError('')
    try {
      const next = await window.pageAuto.listAiApiConnections()
      setConnections(next)
      const id = next.some(c=>c.id===connectionId) ? connectionId : (next.find(c=>c.isDefault) ?? next[0])?.id ?? ''
      setConnectionId(id)
      setModelId(next.find(c=>c.id===id)?.modelId ?? '')
    } catch(err) {setError(explain(err))}
    finally {setBusy(null)}
  }
  useEffect(()=>{void refreshConnections()},[])
  const changeConnection = (id: string) => {
    setConnectionId(id)
    setModelId(connections.find(c=>c.id===id)?.modelId ?? '')
    setModels([])
    setMessage('')
    setError('')
  }
  const loadModels = async () => {
    if (!current) return
    setBusy('models');setError('');setMessage('')
    try {
      const list = await window.pageAuto.discoverAiApiModels({
        connectionId:current.id,provider:current.provider,baseUrl:current.baseUrl,apiKey:''
      })
      setModels(list)
      setMessage('API trả ' + list.length + ' model. Danh sách chưa xác nhận model nào hỗ trợ tạo ảnh; hãy chọn model ảnh phù hợp.')
    } catch(err) {setError(explain(err))}
    finally {setBusy(null)}
  }
  const pick = async (which: 'source' | 'product') => {
    setBusy(which);setError('')
    try {
      const asset = await window.pageAuto.pickAiImageSource()
      if (asset) { if (which==='source') setSource(asset); else setProduct(asset) }
    } catch(err) {setError(explain(err))}
    finally {setBusy(null)}
  }
  const chooseFolder = async () => {
    setBusy('folder');setError('')
    try {
      const chosen = await window.pageAuto.chooseAiImageFolder()
      if (chosen) setFolder(chosen)
    } catch(err) {setError(explain(err))}
    finally {setBusy(null)}
  }
  const canGenerate = Boolean(current && modelId.trim() && prompt.trim() &&
    (mode==='new' || source) && (mode!=='product' || product))
  const generate = async (countOverride?: number) => {
    if (!canGenerate || !current) return
    setBusy('generate');setMessage('');setError('')
    try {
      const generated = await window.pageAuto.generateAiImages({
        connectionId:current.id,modelId:modelId.trim(),mode,prompt,
        count:countOverride ?? count,size,
        source:mode==='new' ? null : source,
        product:mode==='product' ? product : null
      })
      if (!generated.length) throw new Error('Model không tạo được ảnh.')
      const created = generated.map((img,index)=>({
        ...img,id:crypto.randomUUID(),name:filePrefix.trim()+'-'+(images.length+index+1),selected:true
      }))
      setImages(existing=>[...existing,...created])
      setMessage('Đã tạo ' + generated.length + ' ảnh; ảnh chưa được lưu xuống ổ đĩa.')
    } catch(err) {setError(explain(err))}
    finally {setBusy(null)}
  }
  const save = async (items: GalleryImage[]) => {
    if (!items.length) return
    setBusy('save');setError('');setMessage('')
    try {
      let path = folder
      if (!path) {
        const chosen = await window.pageAuto.chooseAiImageFolder()
        if (!chosen) return
        path = chosen
        setFolder(path)
      }
      let total = 0
      for (let index=0; index<items.length; index+=40) {
        const batch = items.slice(index,index+40)
        const files = await window.pageAuto.saveAiImages({images:batch.map(item=>({dataUrl:item.dataUrl,name:item.name}))})
        total += files.length
      }
      setMessage('Đã lưu ' + total + ' file ảnh thật vào ' + path)
    } catch(err) {setError(explain(err))}
    finally {setBusy(null)}
  }
  const toggleSelect = (id: string) => setImages(currentImages=>currentImages.map(img=>
    img.id===id ? {...img,selected:!img.selected} : img
  ))
  return (
    <section className="ai-image-studio" aria-label="Tạo ảnh bằng AI">
      <header className="ai-image-page-title">
        <div>
          <p>THƯ VIỆN NỘI DUNG / TẠO ẢNH AI</p>
          <h2>Tạo ảnh bằng AI</h2>
          <span>Tạo mới, dùng ảnh nền, ghép sản phẩm hoặc chỉnh sửa ảnh. Lưu ảnh trực tiếp vào máy.</span>
        </div>
        <span className="ai-image-readiness">{current ? '● Đã chọn kết nối API' : '○ Chưa chọn API'}</span>
      </header>
      <div className="ai-image-layout">
        <aside className="ai-image-settings" aria-label="Thiết lập tạo ảnh">
          <div className="ai-image-settings-title"><strong>Thiết lập tạo ảnh</strong><span>Chạy độc lập với Tạo bài AI</span></div>
          <div className="ai-image-scroll">
            <div className="ai-image-field">
              <label htmlFor="ai-image-connection">Kết nối AI</label>
              <div className="ai-image-control-pair">
                <select id="ai-image-connection" value={connectionId} onChange={e=>changeConnection(e.target.value)} disabled={Boolean(busy)}>
                  <option value="">— Chọn kết nối đã lưu —</option>
                  {connections.map(c=><option value={c.id} key={c.id}>{c.name} · {c.provider}</option>)}
                </select>
                <button type="button" onClick={()=>void refreshConnections()} disabled={Boolean(busy)} title="Tải lại kết nối AI">↻</button>
              </div>
              <small>API Key sử dụng từ Quản lý AI, không cần nhập lại.</small>
            </div>
            <div className="ai-image-field">
              <label htmlFor="ai-image-model">Model ảnh</label>
              <div className="ai-image-control-pair">
                <input id="ai-image-model" list="ai-image-model-options" value={modelId} onChange={e=>setModelId(e.target.value)} placeholder="Ví dụ: gpt-image-1" disabled={Boolean(busy)}/>
                <datalist id="ai-image-model-options">{models.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
                <button type="button" onClick={()=>void loadModels()} disabled={!current || Boolean(busy)}>Tải model</button>
              </div>
              <small>Model phải hỗ trợ ảnh. Kết nối chỉ tạo văn bản sẽ báo lỗi rõ ràng.</small>
            </div>
            <div className="ai-image-field">
              <strong>Chế độ tạo ảnh</strong>
              <div className="ai-image-mode-grid" aria-label="Chế độ tạo ảnh">
                {modes.map(item=><button type="button" key={item.id} aria-pressed={mode===item.id} className={mode===item.id?'selected':''} onClick={()=>{setMode(item.id);setMessage('')}} disabled={Boolean(busy)}>
                  <b>{item.icon} {item.label}</b><small>{item.description}</small>
                </button>)}
              </div>
            </div>
            <div className="ai-image-field">
              <label htmlFor="ai-image-prompt">Mô tả ảnh muốn tạo</label>
              <textarea id="ai-image-prompt" rows={4} maxLength={4000} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Mô tả chủ thể, ánh sáng, phối cảnh, màu sắc, chất liệu…" disabled={Boolean(busy)}/>
              <small>{prompt.length}/4000 ký tự</small>
            </div>
            {mode!=='new' ? (
              <div className="ai-image-field">
                <strong>{mode==='edit' ? 'Ảnh gốc cần chỉnh sửa' : 'Ảnh nền đầu vào'}</strong>
                <button type="button" className="ai-image-source" onClick={()=>void pick('source')} disabled={Boolean(busy)}>
                  {source ? <img src={source.dataUrl} alt="Ảnh đầu vào đang chọn"/> : <span className="ai-image-upload-icon">＋</span>}
                  <span>{source?.name ?? 'Chọn ảnh từ máy'}<small>PNG, JPG, WEBP · tối đa 10 MB</small></span>
                </button>
              </div>
            ) : null}
            {mode==='product' ? (
              <div className="ai-image-field">
                <strong>Ảnh sản phẩm</strong>
                <button type="button" className="ai-image-source" onClick={()=>void pick('product')} disabled={Boolean(busy)}>
                  {product ? <img src={product.dataUrl} alt="Ảnh sản phẩm đang chọn"/> : <span className="ai-image-upload-icon">＋</span>}
                  <span>{product?.name ?? 'Chọn ảnh sản phẩm'}<small>Ghép với ảnh nền phía trên</small></span>
                </button>
              </div>
            ) : null}
            <div className="ai-image-half-fields">
              <label>Kích thước
                <select value={size} onChange={e=>setSize(e.target.value as AiImageSize)} disabled={Boolean(busy)}>
                  {sizes.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </label>
              <label>Số lượng
                <select value={count} onChange={e=>setCount(Number(e.target.value))} disabled={Boolean(busy)}>
                  {[1,2,3,4].map(n=><option key={n} value={n}>{n} ảnh</option>)}
                </select>
              </label>
            </div>
            <label className="ai-image-field">Tên file khi lưu
              <input value={filePrefix} maxLength={60} onChange={e=>setFilePrefix(e.target.value)} placeholder="anh-san-pham" disabled={Boolean(busy)}/>
            </label>
          </div>
          <div className="ai-image-settings-actions">
            <button className="ai-image-primary" type="button" disabled={Boolean(busy)||!canGenerate} onClick={()=>void generate()}>
              {busy==='generate' ? 'Đang tạo ảnh, vui lòng chờ…' : '✦ Tạo ' + count + ' ảnh bằng AI'}
            </button>
            <small>Yêu cầu tạo ảnh gửi trực tiếp tới API đã chọn và có thể tiêu tốn tín dụng.</small>
          </div>
        </aside>
        <div className="ai-image-gallery-pane">
          <div className="ai-image-gallery-heading">
            <div><strong>Bộ sưu tập ảnh kết quả</strong><small>{images.length} ảnh đã tạo · Đang chọn {selected.length} ảnh</small></div>
            <div>
              <button type="button" onClick={()=>void generate(1)} disabled={Boolean(busy)||!canGenerate}>↻ Tạo lại</button>
              <button type="button" onClick={()=>void save(images)} disabled={Boolean(busy)||!images.length}>↓ Lưu tất cả</button>
            </div>
          </div>
          {error ? <div role="alert" className="ai-image-message error">{error}</div> : null}
          {message ? <div role="status" className="ai-image-message">{message}</div> : null}
          <div className="ai-image-gallery-scroll">
            {images.length ? <div className="ai-image-gallery-grid">
              {images.map((item,index)=><article key={item.id} className={'ai-image-tile'+(item.selected?' selected':'')}>
                <div className="ai-image-tile-media">
                  <img src={item.dataUrl} alt={'Ảnh AI kết quả '+(index+1)}/>
                  <label className="ai-image-tile-select" title="Chọn ảnh để lưu">
                    <input type="checkbox" aria-label={'Chọn ảnh '+(index+1)} checked={item.selected} onChange={()=>toggleSelect(item.id)}/>
                  </label>
                  <span>Ảnh tạo #{index+1}</span>
                </div>
                <div className="ai-image-tile-footer"><div><strong>{item.name}</strong><small>{size} · {item.mimeType.replace('image/','').toUpperCase()}</small></div>
                  <button type="button" aria-label={'Xem lớn ảnh '+(index+1)} title="Xem ảnh lớn" onClick={()=>setViewer(item.id)}>⤢</button>
                  <button type="button" aria-label={'Lưu ảnh '+(index+1)} title="Lưu ảnh" onClick={()=>void save([item])} disabled={Boolean(busy)}>↓</button>
                </div>
              </article>)}
            </div> : <div className="ai-image-empty">
              <span>✧</span><strong>Ảnh được tạo sẽ hiển thị tại đây</strong>
              <p>Chọn model ảnh, nhập mô tả và nhấn Tạo. Có thể chọn nhiều ảnh trước khi lưu vào thư mục Windows.</p>
            </div>}
          </div>
          <div className="ai-image-save-bar">
            <div className="ai-image-folder-control">
              <label>Thư mục lưu ảnh Windows</label>
              <div><span title={folder}>{folder || 'Chưa chọn ổ đĩa / thư mục'}</span><button type="button" onClick={()=>void chooseFolder()} disabled={Boolean(busy)}>Chọn thư mục…</button></div>
              <small>Ảnh được lưu thành file thật; nếu trùng tên sẽ tự thêm số, không ghi đè.</small>
            </div>
            <button className="ai-image-primary" type="button" onClick={()=>void save(selected)} disabled={Boolean(busy)||!selected.length}>Lưu {selected.length} ảnh đã chọn</button>
          </div>
        </div>
      </div>
      {viewer ? <div className="ai-image-viewer" role="dialog" aria-modal="true" aria-label="Xem ảnh AI kích thước lớn" onClick={()=>setViewer(null)}>
        <button type="button" onClick={()=>setViewer(null)}>Đóng ×</button>
        <img src={images.find(img=>img.id===viewer)?.dataUrl} alt="Ảnh AI phóng lớn" onClick={e=>e.stopPropagation()}/>
      </div> : null}
    </section>
  )
}
