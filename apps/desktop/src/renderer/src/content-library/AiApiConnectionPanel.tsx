import { useMemo, useState } from 'react'
import {
  API_PROVIDER_DEFAULTS,
  type AiApiConnectionView, type AiApiModel, type AiApiProvider
} from '../../../shared/aiApiConnections'
import { withAiApiUiTimeout } from './aiApiUiTimeout'
import './aiApiConnectionPanel.css'

interface Props {
  connections: AiApiConnectionView[]
  onConnectionsChange: (next: AiApiConnectionView[]) => void
}
const presets = [
  { label: 'NVIDIA NIM', provider: 'openai-compatible', url: 'https://integrate.api.nvidia.com/v1' },
  { label: 'OpenAI', provider: 'openai-compatible', url: 'https://api.openai.com/v1' },
  { label: 'xAI Grok', provider: 'openai-compatible', url: 'https://api.x.ai/v1' },
  { label: 'OpenRouter', provider: 'openai-compatible', url: 'https://openrouter.ai/api/v1' },
  { label: 'Tương thích OpenAI (tùy chỉnh)', provider: 'openai-compatible', url: '' },
  { label: 'Google Gemini', provider: 'gemini', url: API_PROVIDER_DEFAULTS.gemini },
  { label: 'Anthropic Claude', provider: 'anthropic', url: API_PROVIDER_DEFAULTS.anthropic }
] as const
type Notice = { type: 'success' | 'warning' | 'error'; text: string } | null

export function AiApiConnectionPanel({ connections, onConnectionsChange }: Props) {
  const [presetIndex, setPresetIndex] = useState(0)
  const [name, setName] = useState('NVIDIA NIM')
  const [provider, setProvider] = useState<AiApiProvider>('openai-compatible')
  const [baseUrl, setBaseUrl] = useState<string>(API_PROVIDER_DEFAULTS['openai-compatible'])
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<AiApiModel[]>([])
  const [modelId, setModelId] = useState('')
  const [search, setSearch] = useState('')
  const [jsonOpen, setJsonOpen] = useState(false)
  const [jsonValue, setJsonValue] = useState('')
  const [manualModel, setManualModel] = useState(false)
  const [busy, setBusy] = useState<'discover' | 'test' | 'save' | 'saved' | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [tested, setTested] = useState('')
  const [editingId, setEditingId] = useState('')
  const [editingModels, setEditingModels] = useState<AiApiModel[]>([])
  const [editingSelected, setEditingSelected] = useState('')
  const [editingManual, setEditingManual] = useState(false)
  const visibleModels = useMemo(
    () => models.filter((model) => (model.id + ' ' + model.label).toLowerCase().includes(search.toLowerCase())),
    [models, search]
  )
  const clearModels = () => { setModels([]); setModelId(''); setTested(''); setNotice(null) }
  const selectPreset = (value: string) => {
    const index = Number(value)
    const selected = presets[index]
    if (!selected) return
    setPresetIndex(index)
    setName(selected.label)
    setProvider(selected.provider)
    setBaseUrl(selected.url)
    setApiKey('')
    setManualModel(false)
    clearModels()
  }
  const parseJson = () => {
    try {
      const raw = JSON.parse(jsonValue) as Record<string, unknown>
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid')
      if (raw.provider !== undefined && !['gemini','anthropic','openai-compatible'].includes(String(raw.provider))) throw new Error('invalid')
      const kind = raw.provider === 'gemini' || raw.provider === 'anthropic'
        ? raw.provider : 'openai-compatible'
      const url = raw.baseUrl ?? raw.base_url ?? raw.url
      const key = raw.apiKey ?? raw.api_key ?? raw.key
      if (typeof url !== 'string' || typeof key !== 'string' || !key.trim()) throw new Error('invalid')
      setPresetIndex(kind === 'gemini' ? 5 : kind === 'anthropic' ? 6 : 4)
      setName(typeof raw.name === 'string' ? raw.name : 'Kết nối JSON')
      setProvider(kind)
      setBaseUrl(url)
      setApiKey(key)
      setJsonValue('')
      setJsonOpen(false)
      clearModels()
      setNotice({type:'success',text:'Đã đọc cấu hình JSON. Nhấn Tải Model để xác thực. JSON chưa được lưu.'})
    } catch {
      setNotice({type:'error',text:'JSON cấu hình không hợp lệ. Cần baseUrl, apiKey và provider (nếu có).'})
    }
  }
  const credentials = () => ({provider,baseUrl,apiKey})
  const discover = async () => {
    setBusy('discover'); setNotice(null); setTested('')
    setModels([]); setModelId(''); setSearch('')
    try {
      const next = await window.pageAuto.discoverAiApiModels(credentials())
      setModels(next)
      setNotice(next.length
        ? {type:'success',text:'Đã tải ' + next.length + ' model. Chọn model để dùng.'}
        : {type:'warning',text:'API không trả model phù hợp. Có thể bật nhập Model ID thủ công.'})
    } catch (error) {
      setNotice({type:'error',text:error instanceof Error ? error.message : 'Không tải được model.'})
    } finally { setBusy(null) }
  }
  const test = async () => {
    setBusy('test'); setNotice(null); setTested('')
    try {
      await withAiApiUiTimeout(window.pageAuto.testAiApiModel({...credentials(),modelId}))
      setTested(modelId)
      setNotice({type:'success',text:'Model phản hồi thành công. Có thể lưu kết nối.'})
    } catch (error) {
      setNotice({type:'error',text:error instanceof Error ? error.message : 'Không gọi được model.'})
    } finally { setBusy(null) }
  }
  const save = async () => {
    setBusy('save');setNotice(null)
    try {
      const next = await window.pageAuto.saveAiApiConnection({...credentials(),name,modelId})
      onConnectionsChange(next)
      setApiKey('')
      setModels([]);setModelId('');setTested('')
      setNotice({type:'success',text:'Đã lưu kết nối và model bằng mã hóa cục bộ. API Key không hiển thị lại.'})
    } catch (error) {
      setNotice({type:'error',text:error instanceof Error ? error.message : 'Không lưu được kết nối.'})
    } finally { setBusy(null) }
  }
  const editStoredModel = async (item: AiApiConnectionView) => {
    setEditingId(item.id);setEditingModels([]);setEditingSelected(item.modelId);setEditingManual(false)
    setBusy('saved');setNotice(null)
    try {
      const next=await window.pageAuto.discoverAiApiModels({
        connectionId:item.id,provider:item.provider,baseUrl:item.baseUrl,apiKey:''
      })
      setEditingModels(next)
      if (!next.some(m=>m.id===item.modelId)) setEditingSelected(next[0]?.id??item.modelId)
      if (!next.length) setEditingManual(true)
      setNotice({type:'success',text:'Đã tải '+next.length+' model từ kết nối đã lưu. Không cần nhập lại API Key.'})
    } catch(error) {
      setEditingManual(true)
      setNotice({type:'warning',text:error instanceof Error?error.message:'Không thể tải model; có thể nhập ID thủ công.'})
    } finally {setBusy(null)}
  }
  const testStoredModel = async (item: AiApiConnectionView) => {
    setBusy('saved');setNotice(null)
    try {
      await withAiApiUiTimeout(window.pageAuto.testAiApiModel({connectionId:item.id,provider:item.provider,baseUrl:item.baseUrl,apiKey:'',modelId:editingSelected}))
      setNotice({type:'success',text:'Model từ kết nối đã lưu hoạt động.'})
    } catch(error) {
      setNotice({type:'error',text:error instanceof Error?error.message:'Kiểm tra model thất bại.'})
    } finally {setBusy(null)}
  }
  const updateStoredModel = async (item: AiApiConnectionView) => {
    setBusy('saved');setNotice(null)
    try {
      const next=await window.pageAuto.updateAiApiModel({id:item.id,modelId:editingSelected})
      onConnectionsChange(next)
      setEditingId('')
      setNotice({type:'success',text:'Đã lưu Model mới; lần sau không cần chọn lại.'})
    } catch(error) {
      setNotice({type:'error',text:error instanceof Error?error.message:'Không lưu được model.'})
    } finally {setBusy(null)}
  }
  const changeSaved = async (action: 'remove'|'default',id: string) => {
    if (action === 'remove' && !window.confirm('Xóa kết nối API này? Các bài đã lưu không bị ảnh hưởng.')) return
    setBusy('saved');setNotice(null)
    try {
      const next = action === 'remove'
        ? await window.pageAuto.removeAiApiConnection(id)
        : await window.pageAuto.setDefaultAiApiConnection(id)
      onConnectionsChange(next)
    } catch(error) {
      setNotice({type:'error',text:error instanceof Error?error.message:'Không cập nhật được kết nối.'})
    } finally {setBusy(null)}
  }

  return <div className="ai-api-manager">
    <div className="ai-api-intro">
      <div><strong>Thêm AI bằng API / JSON</strong>
        <p>Chọn nền tảng hoặc nhập API HTTPS, tải danh sách model thật rồi chọn. Không phải nhớ Model ID.</p></div>
      <span>{connections.length} kết nối</span>
    </div>
    <div className="ai-api-form-grid">
      <label>Nhà cung cấp
        <select value={presetIndex} onChange={event => selectPreset(event.target.value)} disabled={Boolean(busy)}
          aria-label="Nền tảng AI">{presets.map((item,index)=><option key={index} value={index}>{item.label}</option>)}</select>
      </label>
      <label>Tên kết nối
        <input value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder="Ví dụ: AI viết bài Page" disabled={Boolean(busy)} />
      </label>
      <label className="ai-api-wide">API Base URL
        <input value={baseUrl} onChange={event=>{setBaseUrl(event.target.value);clearModels()}} placeholder="https://api.example.com/v1" spellCheck={false} disabled={Boolean(busy)} />
      </label>
      <label className="ai-api-wide">API Key
        <input type="password" autoComplete="off" value={apiKey} onChange={event=>{setApiKey(event.target.value);clearModels()}}
          placeholder="Dán API Key — không lưu vào log" disabled={Boolean(busy)}/>
      </label>
    </div>
    <div className="ai-api-form-buttons">
      <button type="button" onClick={()=>setJsonOpen(!jsonOpen)} disabled={Boolean(busy)}>Nhập cấu hình JSON</button>
      <button className="ai-primary-button" type="button" disabled={Boolean(busy)||!apiKey.trim()||!baseUrl.trim()} onClick={()=>void discover()}>
        {busy === 'discover' ? 'Đang tải...' : '↻ Tải danh sách Model'}
      </button>
    </div>
    {jsonOpen ? <div className="ai-api-json">
      <label>Cấu hình JSON (provider, baseUrl, apiKey, name)</label>
      <textarea value={jsonValue} onChange={event=>setJsonValue(event.target.value)} rows={4}
        placeholder={'{"provider":"openai-compatible","name":"NVIDIA","baseUrl":"https://integrate.api.nvidia.com/v1","apiKey":"..."}'} spellCheck={false}/>
      <div><button type="button" onClick={parseJson}>Đọc cấu hình</button><small>JSON cấu hình API sử dụng provider, baseUrl và apiKey; không nhập service-account JSON của Google Cloud.</small></div>
    </div> : null}
    <div className="ai-api-model-block">
      <div className="ai-api-model-heading"><strong>Chọn Model</strong><span>{models.length ? models.length + ' model từ API' : 'Chưa tải model'}</span></div>
      {models.length > 8 && !manualModel ? <input aria-label="Tìm Model" placeholder="Tìm trong danh sách model" value={search} onChange={e=>setSearch(e.target.value)}/> : null}
      {!manualModel ? <select aria-label="Model từ API" value={modelId} onChange={event=>{setModelId(event.target.value);setTested('')}} disabled={Boolean(busy)||models.length===0}>
        <option value="">— Chọn model sau khi tải —</option>
        {visibleModels.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}
        {modelId && !visibleModels.some(m=>m.id===modelId) ? <option value={modelId}>{modelId}</option> : null}
      </select> : <input aria-label="Model ID dự phòng" value={modelId} onChange={e=>{setModelId(e.target.value);setTested('')}} placeholder="Model ID theo tài liệu API" />}
      <label className="ai-api-manual"><input type="checkbox" checked={manualModel} onChange={e=>{setManualModel(e.target.checked);setModelId('');setTested('')}}/> Nhập Model ID thủ công khi API không hỗ trợ liệt kê</label>
      <div className="ai-api-form-buttons">
        <button type="button" onClick={()=>void test()} disabled={Boolean(busy)||!modelId||!apiKey.trim()}> {busy==='test' ? 'Đang kiểm tra (tối đa 25 giây)...' : 'Kiểm tra Model'}</button>
        <button className="ai-primary-button" type="button" onClick={()=>void save()} disabled={Boolean(busy)||!modelId||!apiKey.trim()||!baseUrl.trim()}>
          {busy==='save' ? 'Đang lưu...' : 'Lưu kết nối'}
        </button>
      </div>
      <small className="ai-api-hint">API có thể liệt kê cả model ảnh hoặc model không được cấp quyền tạo văn bản. Kiểm tra thử tối đa 25 giây, sau đó app tự báo kết quả.</small>
      {tested===modelId && modelId ? <small className="ai-api-ok">✓ Model đã phản hồi trong lượt cấu hình này</small> : null}
    </div>
    {notice ? <p className={'ai-api-notice '+notice.type} role="status">{notice.text}</p> : null}
    <div className="ai-api-saved"><strong>Kết nối đã lưu</strong>
      {connections.length ? connections.map(item=><div key={item.id} className="ai-api-saved-entry">
        <div className="ai-api-saved-row">
          <div><strong>{item.name}</strong><small>{item.modelId} · {item.provider}</small></div>
          {item.isDefault ? <span className="ai-api-default">Mặc định</span>
            : <button disabled={Boolean(busy)} type="button" onClick={()=>void changeSaved('default',item.id)}>Đặt mặc định</button>}
          <button type="button" disabled={Boolean(busy)} onClick={()=>void editStoredModel(item)}>↻ Đổi Model</button>
          <button disabled={Boolean(busy)} type="button" onClick={()=>void changeSaved('remove',item.id)} aria-label={'Xóa '+item.name}>Xóa</button>
        </div>
        {editingId === item.id ? <div className="ai-api-saved-model-editor">
          <strong>Tải lại danh sách Model · {item.name}</strong>
          {editingManual || !editingModels.length ?
            <input aria-label="Model ID lưu lại" value={editingSelected} onChange={e=>setEditingSelected(e.target.value)} placeholder="Model ID theo tài liệu API"/> :
            <select aria-label="Chọn Model mới" value={editingSelected} onChange={e=>setEditingSelected(e.target.value)}>
              {editingModels.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}
            </select>}
          <label><input type="checkbox" checked={editingManual} onChange={e=>setEditingManual(e.target.checked)}/> Chế độ nhập thủ công</label>
          <div className="ai-api-form-buttons">
            <button type="button" disabled={Boolean(busy)} onClick={()=>void editStoredModel(item)}>Tải lại Model</button>
            <button type="button" disabled={Boolean(busy)||!editingSelected} onClick={()=>void testStoredModel(item)}>Kiểm tra</button>
            <button className="ai-primary-button" type="button" disabled={Boolean(busy)||!editingSelected} onClick={()=>void updateStoredModel(item)}>Lưu Model mới</button>
            <button type="button" onClick={()=>setEditingId('')} disabled={Boolean(busy)}>Hủy</button>
          </div>
        </div> : null}
      </div>) : <p className="ai-api-empty">Chưa lưu API nào. Các kết nối API của anh sẽ hiện tại đây.</p>}
    </div>
  </div>
}
