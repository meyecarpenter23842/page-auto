import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  ACCOUNT_IMPORT_FIELDS,
  ACCOUNT_STATUSES,
  BUILTIN_IMPORT_PRESETS,
  type AccountColumnLayout,
  type AccountDraft,
  type AccountImportField,
  type AccountImportMapping,
  type AccountImportResult,
  type AccountRecord,
  type ImportPreset
} from '../../../shared/accounts'
import './accounts.css'

type ColumnId = keyof AccountRecord

type GridColumn = {
  id: ColumnId
  label: string
  defaultVisible: boolean
  sensitive?: boolean
  width: number
}

const columns: GridColumn[] = [
  { id: 'uid', label: 'UID / UserName', defaultVisible: true, width: 160 },
  { id: 'name', label: 'Tên', defaultVisible: true, width: 150 },
  { id: 'status', label: 'Status', defaultVisible: true, width: 105 },
  { id: 'category', label: 'Category', defaultVisible: true, width: 130 },
  { id: 'cookieStatus', label: 'Cookie status', defaultVisible: true, width: 115 },
  { id: 'proxy', label: 'Proxy', defaultVisible: true, width: 175 },
  { id: 'note', label: 'Note', defaultVisible: true, width: 220 },
  { id: 'lastUsedAt', label: 'Lần dùng cuối', defaultVisible: true, width: 145 },
  { id: 'username', label: 'UserName riêng', defaultVisible: false, width: 150 },
  { id: 'password', label: 'Password', defaultVisible: false, sensitive: true, width: 145 },
  { id: 'cookie', label: 'Cookie raw', defaultVisible: false, sensitive: true, width: 210 },
  { id: 'twoFactorSecret', label: '2FA', defaultVisible: false, sensitive: true, width: 135 },
  { id: 'email', label: 'Email', defaultVisible: false, width: 185 },
  { id: 'emailPassword', label: 'Pass Email', defaultVisible: false, sensitive: true, width: 145 },
  { id: 'backupEmail', label: 'Backup Email', defaultVisible: false, width: 185 },
  { id: 'phone', label: 'Phone', defaultVisible: false, width: 130 },
  { id: 'friendCount', label: 'Friend', defaultVisible: false, width: 90 },
  { id: 'createdDate', label: 'Ngày tạo', defaultVisible: false, width: 125 },
  { id: 'userAgent', label: 'UserAgent', defaultVisible: false, width: 250 },
  { id: 'proxyType', label: 'Proxy Type', defaultVisible: false, width: 105 },
  { id: 'proxyHost', label: 'Proxy Host', defaultVisible: false, width: 145 },
  { id: 'proxyPort', label: 'Proxy Port', defaultVisible: false, width: 95 },
  { id: 'proxyUsername', label: 'Proxy User', defaultVisible: false, width: 135 },
  { id: 'proxyPassword', label: 'Proxy Pass', defaultVisible: false, sensitive: true, width: 135 },
  { id: 'lastCookieCheck', label: 'Cookie checked', defaultVisible: false, width: 145 },
  { id: 'createdAt', label: 'Added at', defaultVisible: false, width: 145 },
  { id: 'updatedAt', label: 'Updated at', defaultVisible: false, width: 145 }
]

const columnById = new Map(columns.map((column) => [column.id, column]))
const defaultLayout: AccountColumnLayout = {
  order: columns.map((column) => column.id),
  hidden: columns.filter((column) => !column.defaultVisible).map((column) => column.id),
  widths: Object.fromEntries(columns.map((column) => [column.id, column.width]))
}

const importFieldLabels: Record<AccountImportField | 'ignore', string> = {
  ignore: 'Ignore',
  uid: 'UID/UserName',
  username: 'UserName',
  password: 'Password',
  name: 'Name',
  cookie: 'Cookie',
  twoFactorSecret: '2FA',
  email: 'Email',
  emailPassword: 'Password Email',
  backupEmail: 'Backup Email',
  phone: 'Phone',
  proxy: 'Proxy',
  proxyType: 'Proxy Type',
  proxyHost: 'Proxy Host',
  proxyPort: 'Proxy Port',
  proxyUsername: 'Proxy Username',
  proxyPassword: 'Proxy Password',
  userAgent: 'UserAgent',
  category: 'Category',
  note: 'Note',
  friendCount: 'Friend',
  createdDate: 'Created Date'
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

function samplePreview(values: string[], index: number): string {
  const value = values[index] ?? ''
  return value ? ` · ${value.slice(0, 24)}` : ''
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
          <div><p className="eyebrow">Account Manager</p><h2>{account ? `Sửa ${account.uid}` : 'Thêm tài khoản'}</h2></div>
          <button className="icon-button" type="button" onClick={onClose}>×</button>
        </div>

        <div className="form-grid">
          <label><span>UID / UserName *</span><input required value={draft.uid} onChange={(e) => setField('uid', e.target.value)} /></label>
          <label><span>UserName riêng</span><input value={draft.username ?? ''} onChange={(e) => setField('username', e.target.value)} /></label>
          <label><span>Tên hiển thị</span><input value={draft.name ?? ''} onChange={(e) => setField('name', e.target.value)} /></label>
          <label><span>Status</span><select value={draft.status ?? 'unknown'} onChange={(e) => setField('status', e.target.value as AccountDraft['status'])}>{ACCOUNT_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label><span>Category</span><input value={draft.category ?? ''} onChange={(e) => setField('category', e.target.value)} /></label>
          <label><span>Friend</span><input type="number" min="0" value={draft.friendCount ?? ''} onChange={(e) => setField('friendCount', e.target.value === '' ? null : Number(e.target.value))} /></label>
        </div>

        <div className="form-section-title">Credentials & session</div>
        <div className="form-grid">
          <label><span>Password</span><input type="password" autoComplete="off" value={draft.password ?? ''} onChange={(e) => setField('password', e.target.value)} /></label>
          <label><span>2FA</span><input type="password" autoComplete="off" value={draft.twoFactorSecret ?? ''} onChange={(e) => setField('twoFactorSecret', e.target.value)} /></label>
          <label className="span-2"><span>Cookie</span><textarea rows={3} value={draft.cookie ?? ''} onChange={(e) => setField('cookie', e.target.value)} /></label>
          <label><span>Cookie status</span><input value={draft.cookieStatus ?? ''} onChange={(e) => setField('cookieStatus', e.target.value)} /></label>
          <label><span>UserAgent</span><input value={draft.userAgent ?? ''} onChange={(e) => setField('userAgent', e.target.value)} /></label>
        </div>

        <div className="form-section-title">Email & contact</div>
        <div className="form-grid">
          <label><span>Email</span><input value={draft.email ?? ''} onChange={(e) => setField('email', e.target.value)} /></label>
          <label><span>Password Email</span><input type="password" autoComplete="off" value={draft.emailPassword ?? ''} onChange={(e) => setField('emailPassword', e.target.value)} /></label>
          <label><span>Backup Email</span><input value={draft.backupEmail ?? ''} onChange={(e) => setField('backupEmail', e.target.value)} /></label>
          <label><span>Phone</span><input value={draft.phone ?? ''} onChange={(e) => setField('phone', e.target.value)} /></label>
        </div>

        <div className="form-section-title">Proxy & metadata</div>
        <div className="form-grid">
          <label className="span-2"><span>Proxy raw</span><input value={draft.proxy ?? ''} onChange={(e) => setField('proxy', e.target.value)} placeholder="host:port:user:pass hoặc format riêng" /></label>
          <label><span>Proxy Type</span><input value={draft.proxyType ?? ''} onChange={(e) => setField('proxyType', e.target.value)} /></label>
          <label><span>Proxy Host</span><input value={draft.proxyHost ?? ''} onChange={(e) => setField('proxyHost', e.target.value)} /></label>
          <label><span>Proxy Port</span><input type="number" min="0" max="65535" value={draft.proxyPort ?? ''} onChange={(e) => setField('proxyPort', e.target.value === '' ? null : Number(e.target.value))} /></label>
          <label><span>Proxy Username</span><input value={draft.proxyUsername ?? ''} onChange={(e) => setField('proxyUsername', e.target.value)} /></label>
          <label><span>Proxy Password</span><input type="password" autoComplete="off" value={draft.proxyPassword ?? ''} onChange={(e) => setField('proxyPassword', e.target.value)} /></label>
          <label><span>Ngày tạo</span><input value={draft.createdDate ?? ''} onChange={(e) => setField('createdDate', e.target.value)} placeholder="YYYY-MM-DD hoặc text nguồn" /></label>
          <label className="span-2"><span>Note</span><textarea rows={3} value={draft.note ?? ''} onChange={(e) => setField('note', e.target.value)} /></label>
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
  mode: 'quick' | 'custom'
  presets: ImportPreset[]
  onClose: () => void
  onImported: (result: AccountImportResult) => void
  onPresetSaved: (preset: ImportPreset) => void
}

function ImportDialog({ mode, presets, onClose, onImported, onPresetSaved }: ImportDialogProps) {
  const [rawText, setRawText] = useState('')
  const [delimiter, setDelimiter] = useState('|')
  const [mapping, setMapping] = useState<AccountImportMapping>(() => mode === 'quick' ? ['uid', 'cookie'] : [...DEFAULT_CUSTOM_MAPPING])
  const [duplicatePolicy, setDuplicatePolicy] = useState<'skip' | 'update'>('skip')
  const [presetName, setPresetName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sampleValues = useMemo(() => {
    const line = rawText.split(/\r?\n/).find((item) => item.trim()) ?? ''
    return line ? line.split(delimiter || '|').map((value) => value.trim()) : []
  }, [rawText, delimiter])

  useEffect(() => {
    if (mode !== 'custom') return
    setMapping((current) => {
      const targetLength = Math.max(sampleValues.length, MIN_CUSTOM_MAPPING_COLUMNS)
      return current.length >= targetLength ? current : normalizeCustomMapping(current, targetLength)
    })
  }, [mode, sampleValues.length])

  const applyPreset = (nextDelimiter: string, nextMapping: AccountImportMapping) => {
    setDelimiter(nextDelimiter)
    setMapping(mode === 'custom' ? normalizeCustomMapping([...nextMapping]) : [...nextMapping])
  }

  const addMappingColumn = () => setMapping((current) => [...current, 'ignore'])
  const removeMappingColumn = () => setMapping((current) => current.length > MIN_CUSTOM_MAPPING_COLUMNS ? current.slice(0, -1) : current)

  const importNow = async () => {
    setError(null)
    setSaving(true)
    try {
      const result = await window.pageAuto.importAccounts({ rawText, delimiter, mapping, duplicatePolicy })
      onImported(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const savePreset = async () => {
    if (!presetName.trim()) {
      setError('Nhập tên preset trước khi lưu.')
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
      <div className="modal import-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><p className="eyebrow">Account Import</p><h2>{mode === 'quick' ? 'Import nhanh' : 'Custom Import'}</h2></div>
          <button className="icon-button" type="button" onClick={onClose}>×</button>
        </div>

        <div className="import-toolbar-row">
          <label><span>Delimiter</span><input className="delimiter-input" value={delimiter} maxLength={8} onChange={(e) => setDelimiter(e.target.value)} /></label>
          <label><span>UID trùng</span><select value={duplicatePolicy} onChange={(e) => setDuplicatePolicy(e.target.value as 'skip' | 'update')}><option value="skip">Skip</option><option value="update">Update existing</option></select></label>
          {mode === 'custom' ? <span className="mapping-format-hint">Mặc định: UID | Password | 2FA | Cookie | Email | PassEmail | Proxy | UserAgent | Note</span> : null}
        </div>

        <label className="paste-area"><span>Paste dữ liệu — mỗi account một dòng</span><textarea rows={8} value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder="100001|password|2fa|cookie|email|passmail|proxy|useragent|note" /></label>

        <div className="preset-strip">
          {[...BUILTIN_IMPORT_PRESETS.map((preset) => ({ ...preset, id: preset.key })), ...presets].map((preset) => (
            <button key={String(preset.id)} type="button" className="preset-chip" onClick={() => applyPreset(preset.delimiter, preset.mapping)}>{preset.name}</button>
          ))}
        </div>

        {mode === 'custom' ? (
          <div className="mapping-panel">
            <div className="mapping-header">
              <div><strong>Mapping thứ tự cột</strong><span>{sampleValues.length ? `${sampleValues.length} cột dữ liệu · ` : ''}{mapping.length} ô mapping</span></div>
              <div className="mapping-actions">
                <button className="button secondary compact" type="button" onClick={removeMappingColumn} disabled={mapping.length <= MIN_CUSTOM_MAPPING_COLUMNS}>− Cột</button>
                <button className="button secondary compact" type="button" onClick={addMappingColumn}>+ Cột</button>
              </div>
            </div>
            <div className="mapping-grid">
              {mapping.map((field, index) => (
                <label key={index}>
                  <span>Cột {index + 1}{samplePreview(sampleValues, index)}</span>
                  <select value={field} onChange={(e) => setMapping((current) => current.map((item, itemIndex) => itemIndex === index ? e.target.value as AccountImportField | 'ignore' : item))}>
                    <option value="ignore">Ignore</option>
                    {ACCOUNT_IMPORT_FIELDS.map((item) => <option key={item} value={item}>{importFieldLabels[item]}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div className="save-preset-row">
              <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Tên preset custom" />
              <button className="button secondary" type="button" onClick={() => void savePreset()}>Lưu preset</button>
            </div>
          </div>
        ) : (
          <div className="mapping-summary">Format hiện tại: {mapping.map((field) => importFieldLabels[field]).join(` ${delimiter} `)}</div>
        )}

        {error ? <div className="inline-error">{error}</div> : null}
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose}>Hủy</button>
          <button className="button primary" type="button" disabled={saving || !rawText.trim()} onClick={() => void importNow()}>{saving ? 'Đang import…' : 'Import'}</button>
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
      <div className="column-popover-header"><strong>Column settings</strong><button className="icon-button" type="button" onClick={onClose}>×</button></div>
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
      <button className="button secondary full-width" type="button" onClick={() => onChange(defaultLayout)}>Reset default</button>
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
  const [layout, setLayout] = useState<AccountColumnLayout>(defaultLayout)
  const [columnManagerOpen, setColumnManagerOpen] = useState(false)
  const [editorAccount, setEditorAccount] = useState<AccountRecord | null | undefined>(undefined)
  const [importMode, setImportMode] = useState<'quick' | 'custom' | null>(null)
  const [presets, setPresets] = useState<ImportPreset[]>([])
  const [sort, setSort] = useState<{ id: ColumnId; direction: 'asc' | 'desc' }>({ id: 'id', direction: 'desc' })
  const [revealedSecrets, setRevealedSecrets] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)

  const loadAccounts = useCallback(async () => {
    setLoading(true)
    try {
      const next = await window.pageAuto.listAccounts({ search, status: statusFilter, category: categoryFilter })
      setAccounts(next)
      setSelectedIds((current) => new Set([...current].filter((id) => next.some((account) => account.id === id))))
    } finally {
      setLoading(false)
    }
  }, [search, statusFilter, categoryFilter])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAccounts(), 180)
    return () => window.clearTimeout(timer)
  }, [loadAccounts])

  useEffect(() => {
    void Promise.all([window.pageAuto.getAccountColumnLayout(), window.pageAuto.listImportPresets()]).then(([savedLayout, savedPresets]) => {
      setLayout(normalizeLayout(savedLayout))
      setPresets(savedPresets)
    })
  }, [])

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

  const deleteSelected = async () => {
    if (selectedIds.size === 0 || !window.confirm(`Xóa ${selectedIds.size} account đã chọn?`)) return
    const count = await window.pageAuto.deleteAccounts({ ids: [...selectedIds] })
    setNotice(`Đã xóa ${count} account.`)
    setSelectedIds(new Set())
    await loadAccounts()
  }

  const assignCategory = async () => {
    const first = selected[0]
    if (!first) return
    const category = window.prompt('Category mới cho các account đã chọn:', first.category ?? '')
    if (category === null) return
    for (const account of selected) await window.pageAuto.updateAccount({ id: account.id, patch: { category } })
    setNotice(`Đã gán category cho ${selected.length} account.`)
    await loadAccounts()
  }

  const openProfile = async () => {
    const account = selected[0]
    if (selected.length !== 1 || !account) return
    const result = await window.pageAuto.openAccountProfile({ accountId: account.id })
    setNotice(result.status === 'error' ? `Không mở được browser: ${result.message ?? 'unknown error'}` : `Browser profile ${account.uid}: ${result.status}.`)
  }

  const onImportComplete = async (result: AccountImportResult) => {
    setImportMode(null)
    setNotice(`Import: +${result.imported}, update ${result.updated}, skip ${result.skipped}${result.errors.length ? `, lỗi ${result.errors.length}` : ''}.`)
    await loadAccounts()
  }

  const renderCell = (account: AccountRecord, column: GridColumn) => {
    const value = formatCellValue(account, column)
    if (column.id === 'status') return <span className={`status-text status-${account.status}`}>{account.status}</span>
    if (!column.sensitive || value === '—') return <span title={value}>{value}</span>
    const key = `${account.id}:${column.id}`
    const revealed = revealedSecrets.has(key)
    return (
      <span className="secret-cell">
        <span title={revealed ? value : undefined}>{revealed ? value : maskSecret(value)}</span>
        <button type="button" onClick={() => setRevealedSecrets((current) => {
          const next = new Set(current)
          if (next.has(key)) next.delete(key); else next.add(key)
          return next
        })}>{revealed ? 'Ẩn' : 'Hiện'}</button>
      </span>
    )
  }

  return (
    <section className="account-manager">
      <div className="account-grid-panel">
        <div className="account-toolbar">
          <div className="toolbar-group">
            <button className="button primary" type="button" onClick={() => setEditorAccount(null)}>+ Add account</button>
            <button className="button secondary" type="button" onClick={() => setImportMode('quick')}>Import</button>
            <button className="button secondary" type="button" onClick={() => setImportMode('custom')}>Import Custom</button>
            <button className="button secondary" type="button" disabled={selected.length !== 1} onClick={() => setEditorAccount(selected[0] ?? null)}>Edit</button>
            <button className="button danger" type="button" disabled={selectedIds.size === 0} onClick={() => void deleteSelected()}>Delete</button>
          </div>
          <div className="toolbar-group">
            <button className="button secondary" type="button" disabled={selected.length !== 1} onClick={() => void openProfile()}>Open Chrome</button>
            <button className="button secondary" type="button" disabled title="Session check action chưa nối ở màn này">Check session</button>
            <button className="button secondary" type="button" disabled={selectedIds.size === 0} onClick={() => void assignCategory()}>Assign Category</button>
            <div className="column-settings-anchor">
              <button className="button secondary" type="button" onClick={() => setColumnManagerOpen((value) => !value)}>Columns</button>
              {columnManagerOpen ? <ColumnManager layout={layout} onChange={persistLayout} onClose={() => setColumnManagerOpen(false)} /> : null}
            </div>
          </div>
        </div>

        <div className="filter-row">
          <input className="search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm UID, username, tên, email, note…" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}><option value="all">Tất cả status</option>{ACCOUNT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}><option value="">Tất cả category</option>{categories.map((category) => <option key={category}>{category}</option>)}</select>
          <span className="grid-state">{loading ? 'Đang tải…' : `${sortedAccounts.length} dòng · chọn ${selectedIds.size}`}</span>
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
                <tr key={account.id} className={selectedIds.has(account.id) ? 'selected-row' : ''} onDoubleClick={() => setEditorAccount(account)}>
                  <td className="select-column"><input type="checkbox" checked={selectedIds.has(account.id)} onChange={() => setSelectedIds((current) => { const next = new Set(current); if (next.has(account.id)) next.delete(account.id); else next.add(account.id); return next })} /></td>
                  {visibleColumns.map((column) => <td key={column.id} style={{ width: layout.widths[column.id], maxWidth: layout.widths[column.id] }}>{renderCell(account, column)}</td>)}
                </tr>
              ))}
              {!loading && sortedAccounts.length === 0 ? <tr><td className="empty-grid" colSpan={visibleColumns.length + 1}>Chưa có account phù hợp bộ lọc. Import hoặc thêm account để bắt đầu.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      {editorAccount !== undefined ? <AccountEditor account={editorAccount} onClose={() => setEditorAccount(undefined)} onSaved={async () => { setEditorAccount(undefined); setNotice('Đã lưu account.'); await loadAccounts() }} /> : null}
      {importMode ? <ImportDialog mode={importMode} presets={presets} onClose={() => setImportMode(null)} onImported={(result) => void onImportComplete(result)} onPresetSaved={(preset) => setPresets((current) => [...current.filter((item) => item.id !== preset.id), preset].sort((a, b) => a.name.localeCompare(b.name)))} /> : null}
    </section>
  )
}
