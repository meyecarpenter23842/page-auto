import { useCallback, useEffect, useMemo, useState, type FormEvent, type PointerEvent, type ReactNode } from 'react'
import type { AccountRecord, AccountStatus } from '../../../shared/accounts'
import {
  CONTENT_MODES,
  IMAGE_MODES,
  MISSING_IMAGE_POLICIES,
  type CreatePageTabInput,
  type ImageFolderInspection,
  type PageTabAccountRef,
  type PageTabConfig,
  type PageTabSaveInput,
  type PageTabSchedule,
  type PageTabSummary
} from '../../../shared/pageTabs'
import { MultiTabRuntimeDashboard } from './MultiTabRuntimeDashboard'
import './pageTabs.css'
import './pageTabsWorkspace.css'

const dayLabels = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
type EditorModal = 'schedule' | 'groups' | 'content' | 'images' | null

type AccountPickerStatus = AccountStatus | 'all'

function minutesToTime(minutes: number): string {
  const safe = Math.max(0, Math.min(minutes, 1439))
  const hours = Math.floor(safe / 60)
  const mins = safe % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

function timeToMinutes(value: string): number {
  const [hoursText = '0', minutesText = '0'] = value.split(':')
  const hours = Number(hoursText)
  const minutes = Number(minutesText)
  return Math.max(0, Math.min(1439, hours * 60 + minutes))
}

function scheduleIsInvalid(schedule: PageTabSchedule): boolean {
  return schedule.enabled && schedule.startMinute >= schedule.endMinute
}

function parseGroupText(text: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const firstCell = line.split(/[|,;\t]/)[0]?.trim() ?? ''
    if (!firstCell || seen.has(firstCell)) continue
    seen.add(firstCell)
    result.push(firstCell)
  }
  return result
}

function parseContentText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  const blocks = normalized.includes('\n---\n')
    ? normalized.split(/\n-{3,}\n/)
    : normalized.split(/\n\s*\n/)
  return blocks.map((item) => item.trim()).filter(Boolean)
}

function toSaveInput(config: PageTabConfig): PageTabSaveInput {
  return {
    name: config.name,
    pageUid: config.pageUid,
    rotation: { ...config.rotation },
    accounts: config.accounts.map((item, index) => ({
      accountId: item.accountId,
      enabled: item.enabled,
      sortOrder: index,
      postsPerTurn: item.postsPerTurn
    })),
    schedules: config.schedules.map((item, index) => ({
      dayOfWeek: item.dayOfWeek,
      startMinute: item.startMinute,
      endMinute: item.endMinute,
      enabled: item.enabled && item.startMinute < item.endMinute,
      sortOrder: index
    })),
    groupUids: [...config.groupUids],
    contentMode: config.contentMode,
    contents: [...config.contents],
    image: { ...config.image }
  }
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction
  if (index < 0 || target < 0 || target >= items.length) return items
  const next = [...items]
  const current = next[index]
  const other = next[target]
  if (current === undefined || other === undefined) return items
  next[index] = other
  next[target] = current
  return next
}

function accountRef(account: AccountRecord, sortOrder: number): PageTabAccountRef {
  return {
    accountId: account.id,
    enabled: true,
    sortOrder,
    postsPerTurn: null,
    uid: account.uid,
    name: account.name,
    status: account.status,
    category: account.category
  }
}

interface CreateTabModalProps {
  onClose: () => void
  onCreate: (input: CreatePageTabInput) => Promise<void>
}

function CreateTabModal({ onClose, onCreate }: CreateTabModalProps) {
  const [name, setName] = useState('')
  const [pageUid, setPageUid] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onCreate({ name, pageUid })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page-tab-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="page-tab-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="page-tab-modal-header">
          <div><p className="eyebrow">Page Tabs</p><h2>Tạo Page Tab</h2></div>
          <button type="button" className="page-tab-icon-button" onClick={onClose}>×</button>
        </div>
        <label><span>Tên tab</span><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Page A" /></label>
        <label><span>Page UID</span><input required value={pageUid} onChange={(event) => setPageUid(event.target.value)} placeholder="123456789" /></label>
        {error ? <div className="page-tab-error">{error}</div> : null}
        <div className="page-tab-modal-actions">
          <button className="pt-button secondary" type="button" onClick={onClose}>Hủy</button>
          <button className="pt-button primary" type="submit" disabled={saving}>{saving ? 'Đang tạo…' : 'Tạo tab'}</button>
        </div>
      </form>
    </div>
  )
}

interface ConfigEditorModalProps {
  eyebrow: string
  title: string
  onClose: () => void
  children: ReactNode
  actions?: ReactNode
}

function ConfigEditorModal({ eyebrow, title, onClose, children, actions }: ConfigEditorModalProps) {
  return (
    <div className="page-tab-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="page-tab-modal page-tab-config-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="page-tab-modal-header">
          <div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>
          <button type="button" className="page-tab-icon-button" onClick={onClose}>×</button>
        </div>
        <div className="page-tab-modal-body">{children}</div>
        <div className="page-tab-modal-actions">
          <span className="pt-modal-save-note">Thay đổi được lưu khi bấm “Lưu cấu hình”.</span>
          {actions}
          <button className="pt-button primary" type="button" onClick={onClose}>Đóng</button>
        </div>
      </section>
    </div>
  )
}

interface AccountPickerModalProps {
  accounts: AccountRecord[]
  selectedIds: number[]
  onClose: () => void
  onApply: (ids: number[]) => void
}

function AccountPickerModal({ accounts, selectedIds, onClose, onApply }: AccountPickerModalProps) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<AccountPickerStatus>('all')
  const [category, setCategory] = useState('all')
  const [selected, setSelected] = useState<Set<number>>(() => new Set(selectedIds))
  const [paintValue, setPaintValue] = useState<boolean | null>(null)

  useEffect(() => {
    const stopPaint = () => setPaintValue(null)
    window.addEventListener('pointerup', stopPaint)
    window.addEventListener('pointercancel', stopPaint)
    return () => {
      window.removeEventListener('pointerup', stopPaint)
      window.removeEventListener('pointercancel', stopPaint)
    }
  }, [])

  const categories = useMemo(() => Array.from(new Set(
    accounts.map((account) => account.category?.trim()).filter((value): value is string => Boolean(value))
  )).sort((a, b) => a.localeCompare(b)), [accounts])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return accounts.filter((account) => {
      if (status !== 'all' && account.status !== status) return false
      if (category !== 'all' && (account.category ?? '') !== category) return false
      if (!query) return true
      return [account.uid, account.username, account.name, account.email, account.note, account.category]
        .some((value) => value?.toLowerCase().includes(query))
    })
  }, [accounts, category, search, status])

  const setAccountSelected = (accountId: number, value: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (value) next.add(accountId)
      else next.delete(accountId)
      return next
    })
  }

  const beginPaint = (event: PointerEvent<HTMLElement>, accountId: number) => {
    if (event.button !== 0) return
    event.preventDefault()
    const value = !selected.has(accountId)
    setAccountSelected(accountId, value)
    setPaintValue(value)
  }

  const paintRow = (accountId: number) => {
    if (paintValue === null) return
    setAccountSelected(accountId, paintValue)
  }

  const setFilteredSelection = (value: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      for (const account of filtered) {
        if (value) next.add(account.id)
        else next.delete(account.id)
      }
      return next
    })
  }

  return (
    <div className="page-tab-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="page-tab-modal pt-account-picker-modal" role="dialog" aria-modal="true" aria-label="Chọn tài khoản" onMouseDown={(event) => event.stopPropagation()}>
        <div className="page-tab-modal-header">
          <div>
            <p className="eyebrow">Account Manager</p>
            <h2>Chọn tài khoản cho Page Tab</h2>
            <p className="pt-picker-help">Tick nhiều tài khoản một lần. Có thể giữ chuột và rê qua các dòng để tick/bỏ tick hàng loạt.</p>
          </div>
          <button type="button" className="page-tab-icon-button" onClick={onClose}>×</button>
        </div>

        <div className="pt-account-picker-filters">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm UID, username, tên, email, note…" />
          <select value={status} onChange={(event) => setStatus(event.target.value as AccountPickerStatus)}>
            <option value="all">Tất cả status</option>
            <option value="unknown">unknown</option>
            <option value="valid">valid</option>
            <option value="needs_login">needs_login</option>
            <option value="disabled">disabled</option>
          </select>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">Tất cả category</option>
            {categories.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <button className="pt-button secondary" type="button" onClick={() => setFilteredSelection(true)}>Chọn tất cả đang lọc</button>
          <button className="pt-button secondary" type="button" onClick={() => setFilteredSelection(false)}>Bỏ đang lọc</button>
        </div>

        <div className="pt-account-picker-grid-wrap">
          <table className="pt-account-picker-grid">
            <thead>
              <tr>
                <th className="picker-check">Chọn</th>
                <th>UID / UserName</th>
                <th>Tên</th>
                <th>Status</th>
                <th>Category</th>
                <th>Proxy</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((account) => {
                const checked = selected.has(account.id)
                return (
                  <tr
                    key={account.id}
                    className={checked ? 'selected' : ''}
                    onPointerDown={(event) => {
                      const target = event.target as HTMLElement
                      if (target.closest('input,button,select,a')) return
                      beginPaint(event, account.id)
                    }}
                    onPointerEnter={() => paintRow(account.id)}
                  >
                    <td className="picker-check">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => undefined}
                        onPointerDown={(event) => {
                          event.stopPropagation()
                          beginPaint(event, account.id)
                        }}
                      />
                    </td>
                    <td className="picker-uid" title={account.username ? `${account.uid} / ${account.username}` : account.uid}>{account.uid}{account.username ? ` / ${account.username}` : ''}</td>
                    <td title={account.name ?? ''}>{account.name ?? '—'}</td>
                    <td><span className={`pt-account-status status-${account.status}`}>{account.status}</span></td>
                    <td>{account.category ?? '—'}</td>
                    <td title={account.proxy ?? account.proxyHost ?? ''}>{account.proxy ?? (account.proxyHost && account.proxyPort ? `${account.proxyHost}:${account.proxyPort}` : '—')}</td>
                    <td title={account.note ?? ''}>{account.note ?? '—'}</td>
                  </tr>
                )
              })}
              {filtered.length === 0 ? <tr><td colSpan={7} className="pt-account-empty">Không có tài khoản phù hợp bộ lọc.</td></tr> : null}
            </tbody>
          </table>
        </div>

        <div className="page-tab-modal-actions pt-account-picker-actions">
          <span className="pt-modal-save-note">Đã chọn {selected.size}/{accounts.length} tài khoản · đang hiển thị {filtered.length}</span>
          <button className="pt-button secondary" type="button" onClick={() => setSelected(new Set())}>Bỏ tất cả</button>
          <button className="pt-button secondary" type="button" onClick={onClose}>Hủy</button>
          <button className="pt-button primary" type="button" onClick={() => onApply(accounts.filter((account) => selected.has(account.id)).map((account) => account.id))}>Áp dụng lựa chọn</button>
        </div>
      </section>
    </div>
  )
}

export function PageTabsManager() {
  const [tabs, setTabs] = useState<PageTabSummary[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [config, setConfig] = useState<PageTabConfig | null>(null)
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [accountPickerOpen, setAccountPickerOpen] = useState(false)
  const [editorModal, setEditorModal] = useState<EditorModal>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [imageInspection, setImageInspection] = useState<ImageFolderInspection | null>(null)

  const refreshTabs = useCallback(async (preferredId?: number) => {
    const nextTabs = await window.pageAuto.listPageTabs()
    setTabs(nextTabs)
    const nextActive = preferredId ?? activeId ?? nextTabs[0]?.id ?? null
    if (nextActive !== null && nextTabs.some((tab) => tab.id === nextActive)) setActiveId(nextActive)
    else setActiveId(nextTabs[0]?.id ?? null)
  }, [activeId])

  useEffect(() => {
    void Promise.all([window.pageAuto.listPageTabs(), window.pageAuto.listAccounts()])
      .then(([nextTabs, nextAccounts]) => {
        setTabs(nextTabs)
        setAccounts(nextAccounts)
        setActiveId(nextTabs[0]?.id ?? null)
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (activeId === null) {
      setConfig(null)
      setDirty(false)
      return
    }

    let cancelled = false
    setLoading(true)
    void window.pageAuto.getPageTab({ id: activeId })
      .then((nextConfig) => {
        if (cancelled) return
        setConfig(nextConfig)
        setDirty(false)
        setAccountPickerOpen(false)
        setEditorModal(null)
        setError(null)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [activeId])

  useEffect(() => {
    const folderPath = config?.image.folderPath.trim() ?? ''
    if (!folderPath) {
      setImageInspection(null)
      return
    }
    let cancelled = false
    void window.pageAuto.inspectPageTabImageFolder(folderPath).then((result) => {
      if (!cancelled) setImageInspection(result)
    })
    return () => { cancelled = true }
  }, [config?.image.folderPath])

  const patchConfig = (patch: Partial<PageTabConfig>) => {
    setConfig((current) => current ? { ...current, ...patch } : current)
    setDirty(true)
  }

  const createTab = async (input: CreatePageTabInput) => {
    const created = await window.pageAuto.createPageTab(input)
    setCreateOpen(false)
    setNotice(`Đã tạo ${created.name}.`)
    await refreshTabs(created.id)
    setActiveId(created.id)
  }

  const save = async () => {
    if (!config) return
    const invalidScheduleCount = config.schedules.filter(scheduleIsInvalid).length

    setSaving(true)
    setError(null)
    try {
      const saved = await window.pageAuto.updatePageTab({ id: config.id, config: toSaveInput(config) })
      setConfig(saved)
      setDirty(false)
      setNotice(invalidScheduleCount > 0
        ? `Đã lưu cấu hình. ${invalidScheduleCount} khung giờ sai được tự tắt để không chặn lưu.`
        : 'Đã lưu toàn bộ cấu hình Page Tab.')
      await refreshTabs(saved.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const duplicate = async () => {
    if (!config) return
    const copy = await window.pageAuto.duplicatePageTab({ id: config.id })
    setNotice(`Đã nhân bản thành ${copy.name}.`)
    await refreshTabs(copy.id)
    setActiveId(copy.id)
  }

  const deleteCurrent = async () => {
    if (!config || !window.confirm(`Xóa Page Tab “${config.name}”? Group/Content config của tab cũng sẽ bị xóa.`)) return
    await window.pageAuto.deletePageTab({ id: config.id })
    setNotice(`Đã xóa ${config.name}.`)
    setConfig(null)
    setActiveId(null)
    await refreshTabs()
  }

  const applyAccountSelection = (selectedIds: number[]) => {
    if (!config) return
    const selected = new Set(selectedIds)
    const currentById = new Map(config.accounts.map((item) => [item.accountId, item]))
    const next: PageTabAccountRef[] = []

    for (const item of config.accounts) {
      if (selected.has(item.accountId)) next.push({ ...item, sortOrder: next.length })
    }
    for (const account of accounts) {
      if (!selected.has(account.id) || currentById.has(account.id)) continue
      next.push(accountRef(account, next.length))
    }

    patchConfig({ accounts: next })
    setAccountPickerOpen(false)
  }

  const updateAccountRef = (index: number, patch: Partial<PageTabAccountRef>) => {
    if (!config) return
    const next = config.accounts.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)
    patchConfig({ accounts: next })
  }

  const moveAccount = (index: number, direction: -1 | 1) => {
    if (!config) return
    patchConfig({ accounts: moveItem(config.accounts, index, direction) })
  }

  const removeAccount = (index: number) => {
    if (!config) return
    patchConfig({ accounts: config.accounts.filter((_, itemIndex) => itemIndex !== index) })
  }

  const addSchedule = () => {
    if (!config) return
    const schedule: PageTabSchedule = {
      id: -(Date.now()),
      dayOfWeek: 1,
      startMinute: 480,
      endMinute: 660,
      enabled: true,
      sortOrder: config.schedules.length
    }
    patchConfig({ schedules: [...config.schedules, schedule] })
  }

  const updateSchedule = (index: number, patch: Partial<PageTabSchedule>) => {
    if (!config) return
    patchConfig({ schedules: config.schedules.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) })
  }

  const importGroups = async () => {
    const result = await window.pageAuto.pickPageTabTextFile()
    if (!result || !config) return
    patchConfig({ groupUids: parseGroupText(result.content) })
    setNotice(`Đã nạp Group UID từ ${result.path}.`)
  }

  const importContents = async () => {
    const result = await window.pageAuto.pickPageTabTextFile()
    if (!result || !config) return
    patchConfig({ contents: parseContentText(result.content) })
    setNotice(`Đã nạp Content từ ${result.path}.`)
  }

  const pickImageFolder = async () => {
    const folderPath = await window.pageAuto.pickPageTabImageFolder()
    if (!folderPath || !config) return
    patchConfig({ image: { ...config.image, folderPath } })
  }

  if (loading && tabs.length === 0) {
    return <section className="page-tabs-empty"><strong>Đang tải Page Tabs…</strong></section>
  }

  const groupCount = config ? parseGroupText(config.groupUids.join('\n')).length : 0
  const contentCount = config?.contents.filter((item) => item.trim()).length ?? 0
  const enabledAccountCount = config?.accounts.filter((item) => item.enabled).length ?? 0
  const enabledScheduleCount = config?.schedules.filter((item) => item.enabled && !scheduleIsInvalid(item)).length ?? 0

  return (
    <section className="page-tabs-manager">
      <div className="page-tabs-strip" aria-label="Danh sách Page Tabs">
        <div className="page-tabs-scroll">
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab.id}
              className={tab.id === activeId ? 'page-tab-chip active' : 'page-tab-chip'}
              onClick={() => {
                if (dirty && !window.confirm('Cấu hình hiện tại chưa lưu. Chuyển tab và bỏ thay đổi?')) return
                setActiveId(tab.id)
              }}
            >
              <span className="page-tab-status-dot" />
              <span><strong>{tab.name}</strong><small>{tab.pageUid}</small></span>
            </button>
          ))}
        </div>
        <button className="page-tab-add" type="button" onClick={() => setCreateOpen(true)}>+ Page</button>
      </div>

      {notice ? <div className="pt-notice"><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}
      {error ? <div className="page-tab-error">{error}</div> : null}

      {!config ? (
        <div className="page-tabs-empty">
          <strong>Chưa có Page Tab</strong>
          <span>Tạo tab đầu tiên để cấu hình Page UID, tài khoản, lịch chạy, group, nội dung và ảnh.</span>
          <button className="pt-button primary" type="button" onClick={() => setCreateOpen(true)}>+ Tạo Page Tab</button>
        </div>
      ) : (
        <div className="page-tab-workspace">
          <header className="page-tab-editor-header">
            <div>
              <div className="page-tab-title-line">
                <span className="pt-status-badge">{config.status}</span>
                {dirty ? <span className="pt-dirty-badge">Chưa lưu</span> : <span className="pt-saved-badge">Đã lưu</span>}
              </div>
              <h2>{config.name}</h2>
              <p>Page UID: {config.pageUid}</p>
            </div>
            <div className="page-tab-header-actions">
              <button className="pt-button secondary" type="button" onClick={() => void duplicate()}>Nhân bản</button>
              <button className="pt-button danger" type="button" onClick={() => void deleteCurrent()}>Xóa</button>
              <button className="pt-button primary" type="button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Đang lưu…' : 'Lưu cấu hình'}</button>
            </div>
          </header>

          <div className="page-tab-two-column">
            <div className="page-tab-left-pane">
              <section className="pt-panel pt-account-panel pt-account-panel-tall">
                <div className="pt-panel-heading">
                  <div><p className="eyebrow">Tài khoản</p><h3>Danh sách chạy</h3></div>
                  <div className="pt-account-heading-actions">
                    <span className="pt-count-chip">{enabledAccountCount}/{config.accounts.length} bật</span>
                    <button className="pt-button primary" type="button" onClick={() => setAccountPickerOpen(true)}>Chọn tài khoản</button>
                  </div>
                </div>
                <div className="pt-account-grid-wrap">
                  <table className="pt-account-grid">
                    <thead>
                      <tr>
                        <th className="pt-account-index">#</th>
                        <th className="pt-account-enabled">Bật</th>
                        <th>UID / UserName</th>
                        <th>Tên</th>
                        <th>Status</th>
                        <th>Category</th>
                        <th className="pt-account-posts">Bài/lượt</th>
                        <th className="pt-account-order">Thứ tự</th>
                        <th className="pt-account-remove">Xóa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {config.accounts.map((account, index) => (
                        <tr key={account.accountId}>
                          <td className="pt-account-index">{index + 1}</td>
                          <td className="pt-account-enabled"><input type="checkbox" checked={account.enabled} onChange={(event) => updateAccountRef(index, { enabled: event.target.checked })} /></td>
                          <td className="pt-account-uid" title={account.uid}>{account.uid}</td>
                          <td title={account.name ?? ''}>{account.name ?? '—'}</td>
                          <td><span className={`pt-account-status status-${account.status}`}>{account.status}</span></td>
                          <td title={account.category ?? ''}>{account.category ?? '—'}</td>
                          <td className="pt-account-posts"><input type="number" min="1" placeholder={String(config.rotation.postsPerAccount)} value={account.postsPerTurn ?? ''} onChange={(event) => updateAccountRef(index, { postsPerTurn: event.target.value === '' ? null : Number(event.target.value) })} /></td>
                          <td className="pt-account-order"><button type="button" onClick={() => moveAccount(index, -1)} disabled={index === 0}>↑</button><button type="button" onClick={() => moveAccount(index, 1)} disabled={index === config.accounts.length - 1}>↓</button></td>
                          <td className="pt-account-remove"><button type="button" onClick={() => removeAccount(index)}>×</button></td>
                        </tr>
                      ))}
                      {config.accounts.length === 0 ? <tr><td className="pt-account-empty" colSpan={9}>Tab chưa có tài khoản. Bấm “Chọn tài khoản” để tick nhiều account từ Account Manager.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="pt-panel pt-identity-panel pt-compact-panel">
                <div className="pt-panel-heading"><div><p className="eyebrow">Nhận diện</p><h3>Page</h3></div></div>
                <div className="pt-form-grid two">
                  <label><span>Tên tab</span><input value={config.name} onChange={(event) => patchConfig({ name: event.target.value })} /></label>
                  <label><span>Page UID</span><input value={config.pageUid} onChange={(event) => patchConfig({ pageUid: event.target.value })} /></label>
                </div>
              </section>

              <section className="pt-panel pt-rotation-panel pt-compact-panel">
                <div className="pt-panel-heading"><div><p className="eyebrow">Vòng chạy</p><h3>Số bài và thời gian nghỉ</h3></div></div>
                <div className="pt-form-grid five pt-rotation-grid">
                  <label><span>Bài/account</span><input type="number" min="1" value={config.rotation.postsPerAccount} onChange={(event) => patchConfig({ rotation: { ...config.rotation, postsPerAccount: Number(event.target.value) } })} /></label>
                  <label><span>Delay bài min (s)</span><input type="number" min="0" value={config.rotation.postDelayMinSeconds} onChange={(event) => patchConfig({ rotation: { ...config.rotation, postDelayMinSeconds: Number(event.target.value) } })} /></label>
                  <label><span>Delay bài max (s)</span><input type="number" min="0" value={config.rotation.postDelayMaxSeconds} onChange={(event) => patchConfig({ rotation: { ...config.rotation, postDelayMaxSeconds: Number(event.target.value) } })} /></label>
                  <label><span>Đổi account min (s)</span><input type="number" min="0" value={config.rotation.accountDelayMinSeconds} onChange={(event) => patchConfig({ rotation: { ...config.rotation, accountDelayMinSeconds: Number(event.target.value) } })} /></label>
                  <label><span>Đổi account max (s)</span><input type="number" min="0" value={config.rotation.accountDelayMaxSeconds} onChange={(event) => patchConfig({ rotation: { ...config.rotation, accountDelayMaxSeconds: Number(event.target.value) } })} /></label>
                </div>
              </section>
            </div>

            <div className="page-tab-right-pane">
              <MultiTabRuntimeDashboard pageTabId={config.id} compact />

              <section className="pt-panel pt-popup-launcher-panel">
                <div className="pt-panel-heading">
                  <div><p className="eyebrow">Cấu hình nghiệp vụ</p><h3>Thiết lập Page Tab</h3></div>
                  <span className="pt-popup-hint">Mở popup để chỉnh</span>
                </div>
                <div className="pt-config-launchers pt-config-launchers-vertical">
                  <button type="button" onClick={() => setEditorModal('schedule')}>
                    <span>Lịch chạy</span><strong>{enabledScheduleCount} khung bật</strong><small>Ngày và nhiều khung giờ</small>
                  </button>
                  <button type="button" onClick={() => setEditorModal('groups')}>
                    <span>Group Set</span><strong>{groupCount} group</strong><small>Paste hoặc import UID</small>
                  </button>
                  <button type="button" onClick={() => setEditorModal('content')}>
                    <span>Content Set</span><strong>{contentCount} nội dung</strong><small>Thứ tự và chế độ lấy bài</small>
                  </button>
                  <button type="button" onClick={() => setEditorModal('images')}>
                    <span>Image Folder</span><strong>{imageInspection?.exists ? `${imageInspection.fileCount} ảnh` : config.image.folderPath ? 'Cần kiểm tra' : 'Chưa chọn'}</strong><small>Folder, chế độ và policy</small>
                  </button>
                </div>
              </section>

              <section className="pt-panel pt-right-summary">
                <div><span>Accounts</span><strong>{config.accounts.length}</strong></div>
                <div><span>Groups</span><strong>{groupCount}</strong></div>
                <div><span>Contents</span><strong>{contentCount}</strong></div>
                <div><span>Schedule</span><strong>{enabledScheduleCount}</strong></div>
              </section>
            </div>
          </div>
        </div>
      )}

      {createOpen ? <CreateTabModal onClose={() => setCreateOpen(false)} onCreate={createTab} /> : null}

      {config && accountPickerOpen ? (
        <AccountPickerModal
          accounts={accounts}
          selectedIds={config.accounts.map((item) => item.accountId)}
          onClose={() => setAccountPickerOpen(false)}
          onApply={applyAccountSelection}
        />
      ) : null}

      {config && editorModal === 'schedule' ? (
        <ConfigEditorModal eyebrow="Lịch chạy" title="Ngày và khung giờ" onClose={() => setEditorModal(null)} actions={<button className="pt-button secondary" type="button" onClick={addSchedule}>+ Khung giờ</button>}>
          <div className="pt-schedule-list">
            {config.schedules.map((schedule, index) => (
              <div className="pt-schedule-row" key={`${schedule.id}:${index}`}>
                <label><span>Bật</span><input type="checkbox" checked={schedule.enabled} onChange={(event) => updateSchedule(index, { enabled: event.target.checked })} /></label>
                <label><span>Ngày</span><select value={schedule.dayOfWeek} onChange={(event) => updateSchedule(index, { dayOfWeek: Number(event.target.value) })}>{dayLabels.map((label, day) => <option key={label} value={day}>{label}</option>)}</select></label>
                <label><span>Từ</span><input type="time" value={minutesToTime(schedule.startMinute)} onChange={(event) => updateSchedule(index, { startMinute: timeToMinutes(event.target.value) })} /></label>
                <label><span>Đến</span><input type="time" value={minutesToTime(schedule.endMinute)} onChange={(event) => updateSchedule(index, { endMinute: timeToMinutes(event.target.value) })} /></label>
                <button className="pt-remove-button" type="button" onClick={() => patchConfig({ schedules: config.schedules.filter((_, itemIndex) => itemIndex !== index) })}>Xóa</button>
              </div>
            ))}
            {config.schedules.length === 0 ? <div className="pt-empty-row">Chưa có lịch. Có thể để trống nếu tab chạy thủ công.</div> : null}
          </div>
        </ConfigEditorModal>
      ) : null}

      {config && editorModal === 'groups' ? (
        <ConfigEditorModal eyebrow="Group Set" title="Danh sách Group UID" onClose={() => setEditorModal(null)} actions={<button className="pt-button secondary" type="button" onClick={() => void importGroups()}>Import TXT/CSV</button>}>
          <div className="pt-modal-toolbar"><span>{groupCount} group sau khi trim + deduplicate</span></div>
          <textarea className="pt-source-textarea pt-modal-textarea" rows={18} value={config.groupUids.join('\n')} onChange={(event) => patchConfig({ groupUids: event.target.value.split(/\r?\n/) })} placeholder={'123456789\n987654321\n...'} />
          <p className="pt-help">Danh sách này là nguồn gốc; run hiện tại dùng snapshot riêng nên không xóa Group Set gốc.</p>
        </ConfigEditorModal>
      ) : null}

      {config && editorModal === 'content' ? (
        <ConfigEditorModal
          eyebrow="Content Set"
          title="Nội dung đăng"
          onClose={() => setEditorModal(null)}
          actions={(
            <>
              <select className="pt-modal-select" value={config.contentMode} onChange={(event) => patchConfig({ contentMode: event.target.value as PageTabConfig['contentMode'] })}>{CONTENT_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select>
              <button className="pt-button secondary" type="button" onClick={() => void importContents()}>Import TXT</button>
              <button className="pt-button secondary" type="button" onClick={() => patchConfig({ contents: [...config.contents, ''] })}>+ Nội dung</button>
            </>
          )}
        >
          <div className="pt-content-list">
            {config.contents.map((content, index) => (
              <div className="pt-content-item" key={index}>
                <div className="pt-content-order"><strong>#{index + 1}</strong><button type="button" onClick={() => patchConfig({ contents: moveItem(config.contents, index, -1) })} disabled={index === 0}>↑</button><button type="button" onClick={() => patchConfig({ contents: moveItem(config.contents, index, 1) })} disabled={index === config.contents.length - 1}>↓</button></div>
                <textarea rows={5} value={content} onChange={(event) => patchConfig({ contents: config.contents.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} placeholder="Nội dung bài viết…" />
                <button className="pt-remove-button" type="button" onClick={() => patchConfig({ contents: config.contents.filter((_, itemIndex) => itemIndex !== index) })}>Xóa</button>
              </div>
            ))}
            {config.contents.length === 0 ? <div className="pt-empty-row">Chưa có nội dung.</div> : null}
          </div>
        </ConfigEditorModal>
      ) : null}

      {config && editorModal === 'images' ? (
        <ConfigEditorModal eyebrow="Image Folder" title="Nguồn ảnh" onClose={() => setEditorModal(null)}>
          <label className="pt-stack-field"><span>Folder Windows</span><div className="pt-folder-row"><input readOnly value={config.image.folderPath} placeholder="Chưa chọn folder" /><button className="pt-button secondary" type="button" onClick={() => void pickImageFolder()}>Browse</button></div></label>
          <div className="pt-folder-status">
            {!config.image.folderPath ? 'Chưa chọn folder ảnh.' : imageInspection?.exists ? `${imageInspection.fileCount} file ảnh jpg/jpeg/png/webp` : 'Folder không tồn tại hoặc không đọc được.'}
          </div>
          <div className="pt-form-grid three">
            <label><span>Chế độ ảnh</span><select value={config.image.mode} onChange={(event) => patchConfig({ image: { ...config.image, mode: event.target.value as PageTabConfig['image']['mode'] } })}>{IMAGE_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select></label>
            <label><span>Số ảnh/bài</span><input type="number" min="1" value={config.image.imagesPerPost} onChange={(event) => patchConfig({ image: { ...config.image, imagesPerPost: Number(event.target.value) } })} /></label>
            <label><span>Nếu thiếu ảnh</span><select value={config.image.missingPolicy} onChange={(event) => patchConfig({ image: { ...config.image, missingPolicy: event.target.value as PageTabConfig['image']['missingPolicy'] } })}>{MISSING_IMAGE_POLICIES.map((policy) => <option key={policy} value={policy}>{policy}</option>)}</select></label>
          </div>
        </ConfigEditorModal>
      ) : null}
    </section>
  )
}
