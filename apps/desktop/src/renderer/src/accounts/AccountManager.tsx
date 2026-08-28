import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import {
  ACCOUNT_IMPORT_FIELDS,
  ACCOUNT_STATUSES,
  BUILTIN_IMPORT_PRESETS,
  type AccountColumnLayout,
  type AccountDraft,
  type AccountImportField,
  type AccountImportMapping,
  type AccountImportOperation,
  type AccountImportResult,
  type AccountRecord,
  type ImportPreset
} from '../../../shared/accounts'
import { openAccountProfilesBatch } from './accountProfileBatch'
import { Checkpoint282Dialog } from './Checkpoint282Dialog'
import { Checkpoint956Dialog } from './Checkpoint956Dialog'
import './accounts.css'
import './accountEnhancements.css'

type ColumnId = keyof AccountRecord

type GridColumn = {
  id: ColumnId
  label: string
  defaultVisible: boolean
  sensitive?: boolean
  width: number
}

type ContextMenuState = {
  x: number
  y: number
} | null

type PreviewRow = {
  line: number
  raw: string
  values: string[]
}

const accountStatusLabels: Record<AccountRecord['status'], string> = {
  unknown: 'Chưa kiểm tra',
  valid: 'Hoạt động',
  needs_login: 'Cần đăng nhập',
  disabled: 'Đã tắt'
}

const columns: GridColumn[] = [
  { id: 'uid', label: 'UID / Tên đăng nhập', defaultVisible: true, width: 160 },
  { id: 'name', label: 'Tên tài khoản', defaultVisible: true, width: 150 },
  { id: 'status', label: 'Trạng thái', defaultVisible: true, width: 115 },
  { id: 'category', label: 'Nhóm', defaultVisible: true, width: 130 },
  { id: 'cookieStatus', label: 'Trạng thái cookie', defaultVisible: true, width: 130 },
  { id: 'proxy', label: 'Proxy', defaultVisible: true, width: 175 },
  { id: 'note', label: 'Ghi chú', defaultVisible: true, width: 220 },
  { id: 'lastUsedAt', label: 'Lần dùng cuối', defaultVisible: true, width: 145 },
  { id: 'username', label: 'Tên đăng nhập riêng', defaultVisible: false, width: 155 },
  { id: 'password', label: 'Mật khẩu', defaultVisible: false, sensitive: true, width: 145 },
  { id: 'cookie', label: 'Cookie', defaultVisible: false, sensitive: true, width: 210 },
  { id: 'twoFactorSecret', label: '2FA', defaultVisible: false, sensitive: true, width: 135 },
  { id: 'email', label: 'Email', defaultVisible: false, width: 185 },
  { id: 'emailPassword', label: 'Mật khẩu email', defaultVisible: false, sensitive: true, width: 145 },
  { id: 'backupEmail', label: 'Email dự phòng', defaultVisible: false, width: 185 },
  { id: 'phone', label: 'Điện thoại', defaultVisible: false, width: 130 },
  { id: 'friendCount', label: 'Bạn bè', defaultVisible: false, width: 90 },
  { id: 'createdDate', label: 'Ngày tạo', defaultVisible: false, width: 125 },
  { id: 'userAgent', label: 'User-Agent', defaultVisible: false, width: 250 },
  { id: 'proxyType', label: 'Loại proxy', defaultVisible: false, width: 105 },
  { id: 'proxyHost', label: 'Máy chủ proxy', defaultVisible: false, width: 145 },
  { id: 'proxyPort', label: 'Cổng proxy', defaultVisible: false, width: 95 },
  { id: 'proxyUsername', label: 'Tài khoản proxy', defaultVisible: false, width: 135 },
  { id: 'proxyPassword', label: 'Mật khẩu proxy', defaultVisible: false, sensitive: true, width: 135 },
  { id: 'lastCookieCheck', label: 'Kiểm tra cookie', defaultVisible: false, width: 145 },
  { id: 'createdAt', label: 'Ngày thêm', defaultVisible: false, width: 145 },
  { id: 'updatedAt', label: 'Cập nhật lúc', defaultVisible: false, width: 145 }
]

const columnById = new Map(columns.map((column) => [column.id, column]))
const defaultLayout: AccountColumnLayout = {
  order: columns.map((column) => column.id),
  hidden: columns.filter((column) => !column.defaultVisible).map((column) => column.id),
  widths: Object.fromEntries(columns.map((column) => [column.id, column.width]))
}

const importFieldLabels: Record<AccountImportField | 'ignore', string> = {
  ignore: 'Bỏ qua',
  uid: 'UID/Tên đăng nhập',
  username: 'Tên đăng nhập riêng',
  password: 'Mật khẩu',
  name: 'Tên tài khoản',
  cookie: 'Cookie',
  twoFactorSecret: '2FA',
  email: 'Email',
  emailPassword: 'Mật khẩu email',
  backupEmail: 'Email dự phòng',
  phone: 'Điện thoại',
  proxy: 'Proxy',
  proxyType: 'Loại proxy',
  proxyHost: 'Máy chủ proxy',
  proxyPort: 'Cổng proxy',
  proxyUsername: 'Tài khoản proxy',
  proxyPassword: 'Mật khẩu proxy',
  userAgent: 'User-Agent',
  category: 'Nhóm',
  note: 'Ghi chú',
  friendCount: 'Bạn bè',
  createdDate: 'Ngày tạo'
}

const DEFAULT_CUSTOM_MAPPING: AccountImportMapping = [
  'uid',
  'password',
  'twoFactorSecret',
  'cookie',
  'email',
  'emailPassword',
  'proxy',
  'userAgent',
  'note'
]
const MIN_CUSTOM_MAPPING_COLUMNS = DEFAULT_CUSTOM_MAPPING.length
const PREVIEW_LIMIT = 12
const ACCOUNT_RUNTIME_REFRESH_MS = 1_500

function formatDate(value: unknown): string {
  if (typeof value !== 'number' || !value) return '—'
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(value)
}

function formatCellValue(account: AccountRecord, column: GridColumn): string {
  const value = account[column.id]
  if (value === null || value === undefined || value === '') return '—'
  if (['lastUsedAt', 'lastCookieCheck', 'createdAt', 'updatedAt'].includes(column.id)) return formatDate(value)
  return String(value)
}

function maskSecret(value: string): string {
  if (!value) return '—'
  if (value.length <= 6) return '••••••'
  return `${value.slice(0, 3)}••••••${value.slice(-3)}`
}

function normalizeLayout(saved: AccountColumnLayout | null): AccountColumnLayout {
  if (!saved) return defaultLayout
  const known = new Set(columns.map((column) => column.id))
  const order = saved.order.filter((id) => known.has(id as ColumnId))
  for (const column of columns) {
    if (!order.includes(column.id)) order.push(column.id)
  }
  return {
    order,
    hidden: saved.hidden.filter((id) => known.has(id as ColumnId)),
    widths: { ...defaultLayout.widths, ...saved.widths }
  }
}

function normalizeCustomMapping(mapping: AccountImportMapping, targetLength = MIN_CUSTOM_MAPPING_COLUMNS): AccountImportMapping {
  const length = Math.max(targetLength, MIN_CUSTOM_MAPPING_COLUMNS)
  return Array.from({ length }, (_, index) => mapping[index] ?? DEFAULT_CUSTOM_MAPPING[index] ?? 'ignore')
}

function accountToDraft(account: AccountRecord): AccountDraft {
  return {
    uid: account.uid,
    username: account.username,
    password: account.password,
    name: account.name,
    status: account.status,
    category: account.category,
    friendCount: account.friendCount,
    cookie: account.cookie,
    cookieStatus: account.cookieStatus,
    lastCookieCheck: account.lastCookieCheck,
    proxy: account.proxy,
    proxyType: account.proxyType,
    proxyHost: account.proxyHost,
    proxyPort: account.proxyPort,
    proxyUsername: account.proxyUsername,
    proxyPassword: account.proxyPassword,
    twoFactorSecret: account.twoFactorSecret,
    email: account.email,
    emailPassword: account.emailPassword,
    backupEmail: account.backupEmail,
    phone: account.phone,
    userAgent: account.userAgent,
    createdDate: account.createdDate,
    note: account.note,
    lastUsedAt: account.lastUsedAt
  }
}

interface AccountEditorProps {
  account: AccountRecord | null
  onClose: () => void
  onSaved: (account: AccountRecord) => void
}

function AccountEditor({ account, onClose, onSaved }: AccountEditorProps) {
  const [draft, setDraft] = useState<AccountDraft>(() => account ? accountToDraft(account) : { uid: '', status: 'unknown' })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const setField = <K extends keyof AccountDraft>(field: K, value: AccountDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const saved = account
        ? await window.pageAuto.updateAccount({ id: account.id, patch: draft })
        : await window.pageAuto.createAccount(draft)
      onSaved(saved)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="modal account-editor" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><p className="eyebrow">Quản lý tài khoản</p><h2>{account ? `Sửa ${account.uid}` : 'Thêm tài khoản'}</h2></div>
          <button className="icon-button" type="button" onClick={onClose}>×</button>
        </div>

        <div className="form-grid">
          <label><span>UID / Tên đăng nhập *</span><input required value={draft.uid} onChange={(e) => setField('uid', e.target.value)} /></label>
          <label><span>Tên đăng nhập riêng</span><input value={draft.username ?? ''} onChange={(e) => setField('username', e.target.value)} /></label>
          <label><span>Tên tài khoản</span><input value={draft.name ?? ''} onChange={(e) => setField('name', e.target.value)} /></label>
          <label><span>Trạng thái</span><select value={draft.status ?? 'unknown'} onChange={(e) => setField('status', e.target.value as AccountDraft['status'])}>{ACCOUNT_STATUSES.map((status) => <option key={status} value={status}>{accountStatusLabels[status]}</option>)}</select></label>
          <label><span>Nhóm</span><input value={draft.category ?? ''} onChange={(e) => setField('category', e.target.value)} /></label>
          <label><span>Bạn bè</span><input type="number" min="0" value={draft.friendCount ?? ''} onChange={(e) => setField('friendCount', e.target.value === '' ? null : Number(e.target.value))} /></label>
        </div>

        <div className="form-section-title">Đăng nhập & phiên</div>
        <div className="form-grid">
          <label><span>Mật khẩu</span><input type="password" autoComplete="off" value={draft.password ?? ''} onChange={(e) => setField('password', e.target.value)} /></label>
          <label><span>2FA</span><input type="password" autoComplete="off" value={draft.twoFactorSecret ?? ''} onChange={(e) => setField('twoFactorSecret', e.target.value)} /></label>
          <label className="span-2"><span>Cookie</span><textarea rows={3} value={draft.cookie ?? ''} onChange={(e) => setField('cookie', e.target.value)} /></label>
          <label><span>Trạng thái cookie</span><input value={draft.cookieStatus ?? ''} onChange={(e) => setField('cookieStatus', e.target.value)} /></label>
          <label><span>User-Agent</span><input value={draft.userAgent ?? ''} onChange={(e) => setField('userAgent', e.target.value)} /></label>
        </div>

        <div className="form-section-title">Email & liên hệ</div>
        <div className="form-grid">
          <label><span>Email</span><input value={draft.email ?? ''} onChange={(e) => setField('email', e.target.value)} /></label>
          <label><span>Mật khẩu email</span><input type="password" autoComplete="off" value={draft.emailPassword ?? ''} onChange={(e) => setField('emailPassword', e.target.value)} /></label>
          <label><span>Email dự phòng</span><input value={draft.backupEmail ?? ''} onChange={(e) => setField('backupEmail', e.target.value)} /></label>
          <label><span>Điện thoại</span><input value={draft.phone ?? ''} onChange={(e) => setField('phone', e.target.value)} /></label>
        </div>

        <div className="form-section-title">Proxy & thông tin</div>
        <div className="form-grid">
          <label className="span-2"><span>Proxy gốc</span><input value={draft.proxy ?? ''} onChange={(e) => setField('proxy', e.target.value)} placeholder="host:port:user:pass hoặc định dạng riêng" /></label>
          <label><span>Loại proxy</span><input value={draft.proxyType ?? ''} onChange={(e) => setField('proxyType', e.target.value)} /></label>
          <label><span>Máy chủ proxy</span><input value={draft.proxyHost ?? ''} onChange={(e) => setField('proxyHost', e.target.value)} /></label>
          <label><span>Cổng proxy</span><input type="number" min="0" max="65535" value={draft.proxyPort ?? ''} onChange={(e) => setField('proxyPort', e.target.value === '' ? null : Number(e.target.value))} /></label>
          <label><span>Tài khoản proxy</span><input value={draft.proxyUsername ?? ''} onChange={(e) => setField('proxyUsername', e.target.value)} /></label>
          <label><span>Mật khẩu proxy</span><input type="password" autoComplete="off" value={draft.proxyPassword ?? ''} onChange={(e) => setField('proxyPassword', e.target.value)} /></label>
          <label><span>Ngày tạo</span><input value={draft.createdDate ?? ''} onChange={(e) => setField('createdDate', e.target.value)} placeholder="YYYY-MM-DD hoặc dữ liệu nguồn" /></label>
          <label className="span-2"><span>Ghi chú</span><textarea rows={3} value={draft.note ?? ''} onChange={(e) => setField('note', e.target.value)} /></label>
        </div>

        {error ? <div className="inline-error">{error}</div> : null}
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose}>Hủy</button>
          <button className="button primary" type="submit" disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu tài khoản'}</button>
        </div>
      </form>
    </div>
  )
}

interface ImportDialogProps {
  operation: AccountImportOperation
  presets: ImportPreset[]
  onClose: () => void
  onImported: (result: AccountImportResult, operation: AccountImportOperation) => void
  onPresetSaved: (preset: ImportPreset) => void
}

function ImportDialog({ operation, presets, onClose, onImported, onPresetSaved }: ImportDialogProps) {
  const [rawText, setRawText] = useState('')
  const [delimiter, setDelimiter] = useState('|')
  const [mapping, setMapping] = useState<AccountImportMapping>(() => [...DEFAULT_CUSTOM_MAPPING])
  const [presetName, setPresetName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const previewRows = useMemo<PreviewRow[]>(() => rawText
    .split(/\r?\n/)
    .map((raw, index) => ({ line: index + 1, raw, values: raw.split(delimiter || '|') }))
    .filter((row) => row.raw.trim()), [rawText, delimiter])

  const maxDataColumns = useMemo(() => previewRows.reduce((max, row) => Math.max(max, row.values.length), 0), [previewRows])
  const distinctColumnCounts = useMemo(() => new Set(previewRows.map((row) => row.values.length)), [previewRows])

  useEffect(() => {
    setMapping((current) => normalizeCustomMapping(current, Math.max(maxDataColumns, MIN_CUSTOM_MAPPING_COLUMNS)))
  }, [maxDataColumns])

  const applyPreset = (nextDelimiter: string, nextMapping: AccountImportMapping) => {
    setDelimiter(nextDelimiter)
    setMapping(normalizeCustomMapping([...nextMapping], Math.max(maxDataColumns, nextMapping.length)))
  }

  const addMappingColumn = () => setMapping((current) => [...current, 'ignore'])
  const removeMappingColumn = () => setMapping((current) => current.length > MIN_CUSTOM_MAPPING_COLUMNS ? current.slice(0, -1) : current)

  const importNow = async () => {
    const uidMappings = mapping.filter((field) => field === 'uid').length
    if (uidMappings !== 1) {
      setError('Cần ánh xạ đúng 1 cột UID/Tên đăng nhập.')
      return
    }

    if (operation === 'update' && !mapping.some((field) => field !== 'uid' && field !== 'ignore')) {
      setError('Cần chọn ít nhất 1 trường để cập nhật ngoài UID.')
      return
    }

    setError(null)
    setSaving(true)
    try {
      const result = await window.pageAuto.importAccounts({ rawText, delimiter, mapping, operation })
      onImported(result, operation)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const savePreset = async () => {
    if (!presetName.trim()) {
      setError('Nhập tên mẫu trước khi lưu.')
      return
    }
    try {
      const preset = await window.pageAuto.saveImportPreset({ name: presetName, delimiter, mapping })
      onPresetSaved(preset)
      setPresetName('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="modal import-modal account-import-v2" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Quản lý tài khoản</p>
            <h2>{operation === 'insert' ? 'Nhập tài khoản' : 'Cập nhật tài khoản theo UID'}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>×</button>
        </div>

        <div className="import-operation-note">
          {operation === 'insert'
            ? 'UID đã tồn tại sẽ được bỏ qua. Dấu phân cách giữ nguyên vị trí cột trống.'
            : 'UID là khóa tìm tài khoản. Bỏ qua = giữ dữ liệu cũ; ô có cột nhưng để trống = xóa dữ liệu cũ; cột không tồn tại trong dòng = giữ nguyên.'}
        </div>

        <div className="import-toolbar-row">
          <label><span>Dấu phân cách</span><input className="delimiter-input" value={delimiter} maxLength={8} onChange={(e) => setDelimiter(e.target.value)} /></label>
          <span className="mapping-format-hint">Mặc định: UID | Mật khẩu | 2FA | Cookie | Email | Mật khẩu email | Proxy | User-Agent | Ghi chú</span>
        </div>

        <label className="paste-area">
          <span>Dán dữ liệu — mỗi tài khoản một dòng</span>
          <textarea rows={7} value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder="100001|password|2fa|cookie|email|passmail|proxy|useragent|note" />
        </label>

        <div className="preset-strip">
          {[...BUILTIN_IMPORT_PRESETS.map((preset) => ({ ...preset, id: preset.key })), ...presets].map((preset) => (
            <button key={String(preset.id)} type="button" className="preset-chip" onClick={() => applyPreset(preset.delimiter, preset.mapping)}>{preset.name}</button>
          ))}
        </div>

        <div className="mapping-panel">
          <div className="mapping-header">
            <div>
              <strong>Ánh xạ thứ tự cột</strong>
              <span>{maxDataColumns ? `${maxDataColumns} cột dữ liệu · ` : ''}{mapping.length} ô ánh xạ</span>
            </div>
            <div className="mapping-actions">
              <button className="button secondary compact" type="button" onClick={removeMappingColumn} disabled={mapping.length <= MIN_CUSTOM_MAPPING_COLUMNS}>− Cột</button>
              <button className="button secondary compact" type="button" onClick={addMappingColumn}>+ Cột</button>
            </div>
          </div>

          <div className="mapping-grid">
            {mapping.map((field, index) => (
              <label key={index}>
                <span>Cột {index + 1}</span>
                <select value={field} onChange={(e) => setMapping((current) => current.map((item, itemIndex) => itemIndex === index ? e.target.value as AccountImportField | 'ignore' : item))}>
                  <option value="ignore">Bỏ qua</option>
                  {ACCOUNT_IMPORT_FIELDS.map((item) => <option key={item} value={item}>{importFieldLabels[item]}</option>)}
                </select>
              </label>
            ))}
          </div>

          <div className="import-preview-heading">
            <strong>Xem trước dữ liệu</strong>
            <span>{previewRows.length} dòng{distinctColumnCounts.size > 1 ? ' · có dòng lệch số cột' : ''}</span>
          </div>

          <div className="import-preview-wrap">
            <table className="import-preview-table">
              <thead>
                <tr>
                  <th>Dòng</th>
                  {mapping.map((field, index) => <th key={index}>Cột {index + 1}<small>{importFieldLabels[field]}</small></th>)}
                </tr>
              </thead>
              <tbody>
                {previewRows.slice(0, PREVIEW_LIMIT).map((row) => {
                  const mismatched = distinctColumnCounts.size > 1 && row.values.length !== maxDataColumns
                  return (
                    <tr key={row.line} className={mismatched ? 'preview-row-warning' : ''}>
                      <td className="preview-line-number">{row.line}{mismatched ? ' ⚠' : ''}</td>
                      {mapping.map((_field, index) => {
                        const exists = index < row.values.length
                        const value = exists ? (row.values[index] ?? '').trim() : ''
                        return (
                          <td key={index} className={!exists ? 'preview-cell-missing' : value === '' ? 'preview-cell-empty' : ''} title={value || undefined}>
                            {!exists ? '[Không có cột]' : value === '' ? '[Trống]' : value}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
                {previewRows.length === 0 ? <tr><td colSpan={mapping.length + 1} className="preview-empty-state">Dán dữ liệu để xem từng cột trước khi thực hiện.</td></tr> : null}
              </tbody>
            </table>
          </div>
          {previewRows.length > PREVIEW_LIMIT ? <div className="preview-more">Đang xem {PREVIEW_LIMIT}/{previewRows.length} dòng đầu.</div> : null}

          <div className="save-preset-row">
            <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Tên mẫu tùy chỉnh" />
            <button className="button secondary" type="button" onClick={() => void savePreset()}>Lưu mẫu</button>
          </div>
        </div>

        {error ? <div className="inline-error">{error}</div> : null}
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose}>Hủy</button>
          <button className="button primary" type="button" disabled={saving || !rawText.trim()} onClick={() => void importNow()}>
            {saving ? 'Đang xử lý…' : operation === 'insert' ? 'Nhập tài khoản' : 'Cập nhật tài khoản'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface ColumnManagerProps {
  layout: AccountColumnLayout
  onChange: (layout: AccountColumnLayout) => void
  onClose: () => void
}

function ColumnManager({ layout, onChange, onClose }: ColumnManagerProps) {
  const move = (id: string, direction: -1 | 1) => {
    const index = layout.order.indexOf(id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= layout.order.length) return
    const order = [...layout.order]
    const current = order[index]!
    order[index] = order[target]!
    order[target] = current
    onChange({ ...layout, order })
  }

  return (
    <div className="column-popover">
      <div className="column-popover-header"><strong>Cài đặt cột</strong><button className="icon-button" type="button" onClick={onClose}>×</button></div>
      <div className="column-list">
        {layout.order.map((id) => {
          const column = columnById.get(id as ColumnId)
          if (!column) return null
          const hidden = layout.hidden.includes(id)
          return (
            <div className="column-row" key={id}>
              <label><input type="checkbox" checked={!hidden} onChange={() => onChange({ ...layout, hidden: hidden ? layout.hidden.filter((item) => item !== id) : [...layout.hidden, id] })} /><span>{column.label}</span></label>
              <input className="width-input" type="number" min="70" max="520" value={layout.widths[id] ?? column.width} onChange={(e) => onChange({ ...layout, widths: { ...layout.widths, [id]: Math.max(70, Number(e.target.value) || column.width) } })} />
              <button type="button" className="move-button" onClick={() => move(id, -1)}>↑</button>
              <button type="button" className="move-button" onClick={() => move(id, 1)}>↓</button>
            </div>
          )
        })}
      </div>
      <button className="button secondary full-width" type="button" onClick={() => onChange(defaultLayout)}>Khôi phục mặc định</button>
    </div>
  )
}

export function AccountManager() {
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | AccountRecord['status']>('all')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [paintValue, setPaintValue] = useState<boolean | null>(null)
  const [layout, setLayout] = useState<AccountColumnLayout>(defaultLayout)
  const [columnManagerOpen, setColumnManagerOpen] = useState(false)
  const [editorAccount, setEditorAccount] = useState<AccountRecord | null | undefined>(undefined)
  const [importOperation, setImportOperation] = useState<AccountImportOperation | null>(null)
  const [presets, setPresets] = useState<ImportPreset[]>([])
  const [sort, setSort] = useState<{ id: ColumnId; direction: 'asc' | 'desc' }>({ id: 'id', direction: 'desc' })
  const [revealedSecrets, setRevealedSecrets] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  const [openingProfiles, setOpeningProfiles] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [checkpoint282Accounts, setCheckpoint282Accounts] = useState<AccountRecord[] | null>(null)
  const [checkpoint956Accounts, setCheckpoint956Accounts] = useState<AccountRecord[] | null>(null)

  const loadAccounts = useCallback(async (background = false) => {
    if (!background) setLoading(true)
    try {
      const next = await window.pageAuto.listAccounts({ search, status: statusFilter, category: categoryFilter })
      setAccounts(next)
      setSelectedIds((current) => new Set([...current].filter((id) => next.some((account) => account.id === id))))
    } finally {
      if (!background) setLoading(false)
    }
  }, [search, statusFilter, categoryFilter])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAccounts(), 180)
    return () => window.clearTimeout(timer)
  }, [loadAccounts])

  useEffect(() => {
    const timer = window.setInterval(() => void loadAccounts(true), ACCOUNT_RUNTIME_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [loadAccounts])

  useEffect(() => {
    void Promise.all([window.pageAuto.getAccountColumnLayout(), window.pageAuto.listImportPresets()]).then(([savedLayout, savedPresets]) => {
      setLayout(normalizeLayout(savedLayout))
      setPresets(savedPresets)
    })
  }, [])

  useEffect(() => {
    const stopPaint = () => setPaintValue(null)
    window.addEventListener('pointerup', stopPaint)
    window.addEventListener('pointercancel', stopPaint)
    window.addEventListener('blur', stopPaint)
    return () => {
      window.removeEventListener('pointerup', stopPaint)
      window.removeEventListener('pointercancel', stopPaint)
      window.removeEventListener('blur', stopPaint)
    }
  }, [])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [contextMenu])

  const persistLayout = (next: AccountColumnLayout) => {
    setLayout(next)
    void window.pageAuto.saveAccountColumnLayout({ layout: next })
  }

  const visibleColumns = useMemo(() => layout.order
    .filter((id) => !layout.hidden.includes(id))
    .map((id) => columnById.get(id as ColumnId))
    .filter((column): column is GridColumn => Boolean(column)), [layout])

  const sortedAccounts = useMemo(() => [...accounts].sort((left, right) => {
    const a = left[sort.id]
    const b = right[sort.id]
    if (a === b) return 0
    if (a === null || a === undefined) return 1
    if (b === null || b === undefined) return -1
    const result = typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b), 'vi', { numeric: true, sensitivity: 'base' })
    return sort.direction === 'asc' ? result : -result
  }), [accounts, sort])

  const categories = useMemo(() => [...new Set(accounts.map((account) => account.category).filter((value): value is string => Boolean(value)))].sort(), [accounts])
  const selected = accounts.filter((account) => selectedIds.has(account.id))

  const toggleSort = (id: ColumnId) => setSort((current) => current.id === id
    ? { id, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    : { id, direction: 'asc' })

  const setAccountSelected = (accountId: number, value: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (value) next.add(accountId)
      else next.delete(accountId)
      return next
    })
  }

  const beginPaint = (event: ReactPointerEvent<HTMLElement>, accountId: number) => {
    if (event.button !== 0 || event.detail > 1) return
    event.preventDefault()
    const value = !selectedIds.has(accountId)
    setAccountSelected(accountId, value)
    setPaintValue(value)
    setContextMenu(null)
  }

  const paintRow = (accountId: number) => {
    if (paintValue === null) return
    setAccountSelected(accountId, paintValue)
  }

  const selectAllFiltered = () => {
    setSelectedIds(new Set(sortedAccounts.map((account) => account.id)))
    setContextMenu(null)
  }

  const clearSelection = () => {
    setSelectedIds(new Set())
    setContextMenu(null)
  }

  const copySelectedUids = async () => {
    if (selected.length === 0) return
    const text = selected.map((account) => account.uid).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setNotice(`Đã sao chép ${selected.length} UID.`)
    } catch {
      window.prompt('Sao chép UID:', text)
    }
    setContextMenu(null)
  }

  const deleteSelected = async () => {
    if (selectedIds.size === 0 || !window.confirm(`Xóa ${selectedIds.size} tài khoản đã chọn?`)) return
    const count = await window.pageAuto.deleteAccounts({ ids: [...selectedIds] })
    setNotice(`Đã xóa ${count} tài khoản.`)
    setSelectedIds(new Set())
    setContextMenu(null)
    await loadAccounts()
  }

  const assignCategory = async () => {
    const first = selected[0]
    if (!first) return
    const category = window.prompt('Nhóm mới cho các tài khoản đã chọn:', first.category ?? '')
    if (category === null) return
    for (const account of selected) await window.pageAuto.updateAccount({ id: account.id, patch: { category } })
    setNotice(`Đã gán nhóm cho ${selected.length} tài khoản.`)
    setContextMenu(null)
    await loadAccounts()
  }

  const openProfile = async () => {
    if (selected.length === 0 || openingProfiles) return
    const targets = selected.map((account) => ({ id: account.id, uid: account.uid }))
    setOpeningProfiles(true)
    setContextMenu(null)
    try {
      const outcomes = await openAccountProfilesBatch(
        targets,
        (accountId) => window.pageAuto.openAccountProfile({ accountId })
      )
      const started = outcomes.filter((item) => item.status === 'started').length
      const alreadyOpen = outcomes.filter((item) => item.status === 'already_open').length
      const failed = outcomes.filter((item) => item.status === 'error')
      const firstFailure = failed[0]
      setNotice(
        `Đã xử lý ${outcomes.length} Chrome: mở mới ${started}, đang mở ${alreadyOpen}, lỗi ${failed.length}`
        + (firstFailure ? ` · ${firstFailure.uid}: ${firstFailure.message ?? 'lỗi không xác định'}` : '.')
      )
      await loadAccounts()
    } finally {
      setOpeningProfiles(false)
    }
  }

  const onImportComplete = async (result: AccountImportResult, operation: AccountImportOperation) => {
    setImportOperation(null)
    const action = operation === 'insert' ? 'Nhập' : 'Cập nhật'
    setNotice(`${action} dữ liệu: thêm ${result.imported}, cập nhật ${result.updated}, bỏ qua ${result.skipped}${result.errors.length ? `, lỗi ${result.errors.length}` : ''}.`)
    await loadAccounts()
  }

  const renderCell = (account: AccountRecord, column: GridColumn) => {
    const value = formatCellValue(account, column)
    if (column.id === 'status') return <span className={`status-text status-${account.status}`}>{accountStatusLabels[account.status]}</span>
    if (!column.sensitive || value === '—') return <span title={value}>{value}</span>
    const key = `${account.id}:${column.id}`
    const revealed = revealedSecrets.has(key)
    return (
      <span className="secret-cell">
        <span title={revealed ? value : undefined}>{revealed ? value : maskSecret(value)}</span>
        <button type="button" onClick={(event) => {
          event.stopPropagation()
          setRevealedSecrets((current) => {
            const next = new Set(current)
            if (next.has(key)) next.delete(key); else next.add(key)
            return next
          })
        }}>{revealed ? 'Ẩn' : 'Hiện'}</button>
      </span>
    )
  }

  const openContextMenu = (account: AccountRecord, event: ReactMouseEvent<HTMLTableRowElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setPaintValue(null)
    setSelectedIds((current) => current.has(account.id) ? current : new Set([account.id]))
    const menuWidth = 220
    const menuHeight = 390
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8))
    })
  }

  return (
    <section className="account-manager">
      <div className="account-grid-panel">
        <div className="account-toolbar">
          <div className="toolbar-group">
            <button className="button primary" type="button" onClick={() => setEditorAccount(null)}>+ Thêm tài khoản</button>
            <button className="button secondary" type="button" onClick={() => setImportOperation('insert')}>Nhập tài khoản</button>
            <button className="button secondary" type="button" onClick={() => setImportOperation('update')}>Cập nhật tài khoản</button>
            <button className="button secondary" type="button" disabled={selected.length !== 1} onClick={() => setEditorAccount(selected[0] ?? null)}>Sửa</button>
            <button className="button danger" type="button" disabled={selectedIds.size === 0} onClick={() => void deleteSelected()}>Xóa</button>
          </div>
          <div className="toolbar-group">
            <button className="button secondary" type="button" disabled={selectedIds.size === 0 || openingProfiles} onClick={() => void openProfile()}>{openingProfiles ? 'Đang mở…' : selected.length > 1 ? `Mở ${selected.length} Chrome` : 'Mở Chrome'}</button>
            <button className="button secondary" type="button" disabled title="Kiểm tra phiên được thực hiện khi mở Chrome hoặc trước mỗi lượt đăng">Kiểm tra phiên</button>
            <button className="button secondary" type="button" disabled={selectedIds.size === 0} onClick={() => void assignCategory()}>Gán nhóm</button>
            <div className="column-settings-anchor">
              <button className="button secondary" type="button" onClick={() => setColumnManagerOpen((value) => !value)}>Cột</button>
              {columnManagerOpen ? <ColumnManager layout={layout} onChange={persistLayout} onClose={() => setColumnManagerOpen(false)} /> : null}
            </div>
          </div>
        </div>

        <div className="filter-row">
          <input className="search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm UID, tên đăng nhập, tên, email, ghi chú…" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}><option value="all">Tất cả trạng thái</option>{ACCOUNT_STATUSES.map((status) => <option key={status} value={status}>{accountStatusLabels[status]}</option>)}</select>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}><option value="">Tất cả nhóm</option>{categories.map((category) => <option key={category}>{category}</option>)}</select>
          <span className="grid-state">{loading ? 'Đang tải…' : `${sortedAccounts.length} dòng · đã chọn ${selectedIds.size}`}</span>
        </div>

        {notice ? <div className="notice-bar"><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}

        <div className="data-grid-wrap">
          <table className="account-grid">
            <thead><tr>
              <th className="select-column"><input type="checkbox" aria-label="Chọn tất cả" checked={sortedAccounts.length > 0 && sortedAccounts.every((account) => selectedIds.has(account.id))} onChange={(e) => setSelectedIds(e.target.checked ? new Set(sortedAccounts.map((account) => account.id)) : new Set())} /></th>
              {visibleColumns.map((column) => <th key={column.id} style={{ width: layout.widths[column.id], minWidth: layout.widths[column.id] }}><button type="button" onClick={() => toggleSort(column.id)}>{column.label}<span>{sort.id === column.id ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}</span></button></th>)}
            </tr></thead>
            <tbody>
              {sortedAccounts.map((account) => (
                <tr
                  key={account.id}
                  className={selectedIds.has(account.id) ? 'selected-row' : ''}
                  onPointerDown={(event) => {
                    const target = event.target as HTMLElement
                    if (target.closest('input,button,select,a')) return
                    beginPaint(event, account.id)
                  }}
                  onPointerEnter={() => paintRow(account.id)}
                  onContextMenu={(event) => openContextMenu(account, event)}
                  onDoubleClick={() => { setPaintValue(null); setEditorAccount(account) }}
                >
                  <td className="select-column">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(account.id)}
                      onChange={() => undefined}
                      onPointerDown={(event) => {
                        event.stopPropagation()
                        beginPaint(event, account.id)
                      }}
                    />
                  </td>
                  {visibleColumns.map((column) => <td key={column.id} style={{ width: layout.widths[column.id], maxWidth: layout.widths[column.id] }}>{renderCell(account, column)}</td>)}
                </tr>
              ))}
              {!loading && sortedAccounts.length === 0 ? <tr><td className="empty-grid" colSpan={visibleColumns.length + 1}>Chưa có tài khoản phù hợp bộ lọc. Hãy nhập hoặc thêm tài khoản để bắt đầu.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      {contextMenu ? (
        <div className="account-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
          <div className="context-menu-meta">Đã chọn {selected.length} tài khoản</div>
          <button type="button" disabled={selected.length !== 1} onClick={() => { setEditorAccount(selected[0] ?? null); setContextMenu(null) }}>Sửa tài khoản</button>
          <button type="button" disabled={selectedIds.size === 0 || openingProfiles} onClick={() => void openProfile()}>{openingProfiles ? 'Đang mở…' : selected.length > 1 ? `Mở ${selected.length} Chrome` : 'Mở Chrome'}</button>
          <button type="button" disabled={selectedIds.size === 0} onClick={() => {
            const targets = sortedAccounts.filter((account) => selectedIds.has(account.id))
            if (targets.length > 0) setCheckpoint282Accounts(targets)
            setContextMenu(null)
          }}>Checkpoint 282…</button>
          <button type="button" disabled={selectedIds.size === 0} onClick={() => {
            const targets = sortedAccounts.filter((account) => selectedIds.has(account.id))
            if (targets.length > 0) setCheckpoint956Accounts(targets)
            setContextMenu(null)
          }}>Checkpoint 956…</button>
          <button type="button" disabled title="Kiểm tra phiên được thực hiện khi mở Chrome hoặc trước mỗi lượt đăng">Kiểm tra phiên</button>
          <button type="button" disabled={selectedIds.size === 0} onClick={() => void assignCategory()}>Gán nhóm</button>
          <button type="button" disabled={selectedIds.size === 0} onClick={() => void copySelectedUids()}>Sao chép UID</button>
          <div className="context-menu-separator" />
          <button type="button" disabled={sortedAccounts.length === 0} onClick={selectAllFiltered}>Chọn tất cả đang lọc</button>
          <button type="button" disabled={selectedIds.size === 0} onClick={clearSelection}>Bỏ chọn tất cả</button>
          <div className="context-menu-separator" />
          <button className="context-danger" type="button" disabled={selectedIds.size === 0} onClick={() => void deleteSelected()}>Xóa tài khoản</button>
        </div>
      ) : null}

      {checkpoint282Accounts ? <Checkpoint282Dialog accounts={checkpoint282Accounts} onClose={() => setCheckpoint282Accounts(null)} /> : null}
      {checkpoint956Accounts ? <Checkpoint956Dialog accounts={checkpoint956Accounts} onClose={() => setCheckpoint956Accounts(null)} /> : null}
      {editorAccount !== undefined ? <AccountEditor account={editorAccount} onClose={() => setEditorAccount(undefined)} onSaved={async () => { setEditorAccount(undefined); setNotice('Đã lưu tài khoản.'); await loadAccounts() }} /> : null}
      {importOperation ? <ImportDialog operation={importOperation} presets={presets} onClose={() => setImportOperation(null)} onImported={(result, operation) => void onImportComplete(result, operation)} onPresetSaved={(preset) => setPresets((current) => [...current.filter((item) => item.id !== preset.id), preset].sort((a, b) => a.name.localeCompare(b.name)))} /> : null}
    </section>
  )
}
