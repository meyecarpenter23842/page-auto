import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { AccountRecord, AccountStatus } from '../../../shared/accounts'
import type {
  CreatePageTabInput,
  PageTabAccountRef,
  PageTabConfig,
  PageTabPostLibrary,
  PageTabSaveInput,
  PageTabSchedule,
  PageTabSummary
} from '../../../shared/pageTabs'
import type { RotationRuntimeSnapshot } from '../../../shared/rotation'
import { PostLibraryModal } from './PostLibraryModal'
import {
  accountRuntimeLabel,
  activeRuntimeForPage,
  indexRotationRuntimes,
  rotationRuntimeLabel,
  runtimeEmptyPreviewMessage,
  runtimeProgressLabel
} from './pageRuntimePresentation'
import { collapseEveryDaySchedules, EVERY_DAY_SCHEDULE, expandEveryDaySchedules } from './scheduleEditor'
import './pageTabs.css'
import './pageTabsWorkspace.css'
import './postLibrary.css'
import './scheduleEditor.css'

const dayLabels = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
type ConfigSection = 'accounts' | 'identity' | 'rotation' | 'schedule' | 'groups'
type EditorModal = 'schedule' | 'groups' | null
type AccountPickerStatus = AccountStatus | 'all'

function minutesToTime(minutes: number): string {
  const safe = Math.max(0, Math.min(minutes, 1439))
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

function timeToMinutes(value: string): number {
  const [hours = '0', minutes = '0'] = value.split(':')
  return Math.max(0, Math.min(1439, Number(hours) * 60 + Number(minutes)))
}

function scheduleIsInvalid(schedule: PageTabSchedule): boolean {
  return schedule.enabled && schedule.startMinute >= schedule.endMinute
}

function parseGroupText(text: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const first = line.split(/[|,;\t]/)[0]?.trim() ?? ''
    if (!first || seen.has(first)) continue
    seen.add(first)
    result.push(first)
  }
  return result
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
    schedules: expandEveryDaySchedules(config.schedules).map((item, index) => ({
      ...item,
      enabled: item.enabled && item.startMinute < item.endMinute,
      sortOrder: index
    })),
    groupUids: parseGroupText(config.groupUids.join('\n')),
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

function mergeSavedSection(draft: PageTabConfig, saved: PageTabConfig, section: ConfigSection): PageTabConfig {
  if (section === 'accounts') return { ...draft, accounts: saved.accounts }
  if (section === 'identity') return { ...draft, name: saved.name, pageUid: saved.pageUid }
  if (section === 'rotation') return { ...draft, rotation: saved.rotation }
  if (section === 'schedule') return { ...draft, schedules: collapseEveryDaySchedules(saved.schedules) }
  return { ...draft, groupUids: saved.groupUids }
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
        <div className="page-tab-modal-header"><div><p className="eyebrow">Page Tabs</p><h2>Tạo Page Tab</h2></div><button type="button" className="page-tab-icon-button" onClick={onClose}>×</button></div>
        <label><span>Tên tab</span><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Page A" /></label>
        <label><span>Page UID</span><input required value={pageUid} onChange={(event) => setPageUid(event.target.value)} placeholder="123456789" /></label>
        {error ? <div className="page-tab-error">{error}</div> : null}
        <div className="page-tab-modal-actions"><button className="pt-button secondary" type="button" onClick={onClose}>Hủy</button><button className="pt-button primary" type="submit" disabled={saving}>{saving ? 'Đang tạo…' : 'Tạo tab'}</button></div>
      </form>
    </div>
  )
}

interface ConfigModalProps {
  eyebrow: string
  title: string
  onClose: () => void
  children: ReactNode
  actions?: ReactNode
}

function ConfigModal({ eyebrow, title, onClose, children, actions }: ConfigModalProps) {
  return (
    <div className="page-tab-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="page-tab-modal page-tab-config-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="page-tab-modal-header"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><button type="button" className="page-tab-icon-button" onClick={onClose}>×</button></div>
        <div className="page-tab-modal-body">{children}</div>
        <div className="page-tab-modal-actions">{actions}<button className="pt-button secondary" type="button" onClick={onClose}>Đóng</button></div>
      </section>
    </div>
  )
}

interface AccountPickerProps {
  accounts: AccountRecord[]
  selectedIds: number[]
  onClose: () => void
  onApply: (ids: number[]) => void
}

function AccountPicker({ accounts, selectedIds, onClose, onApply }: AccountPickerProps) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<AccountPickerStatus>('all')
  const [category, setCategory] = useState('all')
  const [selected, setSelected] = useState(() => new Set(selectedIds))

  const categories = useMemo(() => Array.from(new Set(accounts.map((account) => account.category?.trim()).filter((value): value is string => Boolean(value)))).sort(), [accounts])
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return accounts.filter((account) => {
      if (status !== 'all' && account.status !== status) return false
      if (category !== 'all' && (account.category ?? '') !== category) return false
      return !query || [account.uid, account.username, account.name, account.email, account.note, account.category].some((value) => value?.toLowerCase().includes(query))
    })
  }, [accounts, category, search, status])

  const toggle = (id: number, checked: boolean) => setSelected((current) => {
    const next = new Set(current)
    if (checked) next.add(id)
    else next.delete(id)
    return next
  })

  return (
    <div className="page-tab-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="page-tab-modal pt-account-picker-modal" role="dialog" aria-modal="true" aria-label="Chọn tài khoản" onMouseDown={(event) => event.stopPropagation()}>
        <div className="page-tab-modal-header"><div><p className="eyebrow">Account Manager</p><h2>Chọn tài khoản cho Page Tab</h2></div><button type="button" className="page-tab-icon-button" onClick={onClose}>×</button></div>
        <div className="pt-account-picker-filters">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm UID, tên, email, note…" />
          <select value={status} onChange={(event) => setStatus(event.target.value as AccountPickerStatus)}><option value="all">Tất cả status</option><option value="unknown">unknown</option><option value="valid">valid</option><option value="needs_login">needs_login</option><option value="disabled">disabled</option></select>
          <select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">Tất cả category</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <button className="pt-button secondary" type="button" onClick={() => setSelected((current) => new Set([...current, ...filtered.map((item) => item.id)]))}>Chọn đang lọc</button>
        </div>
        <div className="pt-account-picker-grid-wrap">
          <table className="pt-account-picker-grid"><thead><tr><th>Chọn</th><th>UID / UserName</th><th>Tên</th><th>Status</th><th>Category</th><th>Note</th></tr></thead><tbody>
            {filtered.map((account) => <tr key={account.id} className={selected.has(account.id) ? 'selected' : ''}><td><input type="checkbox" checked={selected.has(account.id)} onChange={(event) => toggle(account.id, event.target.checked)} /></td><td className="picker-uid">{account.uid}{account.username ? ` / ${account.username}` : ''}</td><td>{account.name ?? '—'}</td><td><span className={`pt-account-status status-${account.status}`}>{account.status}</span></td><td>{account.category ?? '—'}</td><td>{account.note ?? '—'}</td></tr>)}
            {filtered.length === 0 ? <tr><td colSpan={6} className="pt-account-empty">Không có tài khoản phù hợp.</td></tr> : null}
          </tbody></table>
        </div>
        <div className="page-tab-modal-actions"><span className="pt-modal-save-note">Đã chọn {selected.size}/{accounts.length}</span><button className="pt-button secondary" type="button" onClick={onClose}>Hủy</button><button className="pt-button primary" type="button" onClick={() => onApply(accounts.filter((account) => selected.has(account.id)).map((account) => account.id))}>Áp dụng</button></div>
      </section>
    </div>
  )
}

export function PageTabsManager() {
  const [tabs, setTabs] = useState<PageTabSummary[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [config, setConfig] = useState<PageTabConfig | null>(null)
  const [postLibrary, setPostLibrary] = useState<PageTabPostLibrary | null>(null)
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [runtimeByTab, setRuntimeByTab] = useState<Record<number, RotationRuntimeSnapshot>>({})
  const [loading, setLoading] = useState(true)
  const [savingSection, setSavingSection] = useState<ConfigSection | 'all' | null>(null)
  const [dirtySections, setDirtySections] = useState<Set<ConfigSection>>(() => new Set())
  const [createOpen, setCreateOpen] = useState(false)
  const [accountPickerOpen, setAccountPickerOpen] = useState(false)
  const [editorModal, setEditorModal] = useState<EditorModal>(null)
  const [postLibraryOpen, setPostLibraryOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refreshTabs = useCallback(async (preferredId?: number) => {
    const nextTabs = await window.pageAuto.listPageTabs()
    setTabs(nextTabs)
    const nextActive = preferredId ?? activeId ?? nextTabs[0]?.id ?? null
    setActiveId(nextTabs.some((tab) => tab.id === nextActive) ? nextActive : nextTabs[0]?.id ?? null)
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
      setPostLibrary(null)
      setDirtySections(new Set())
      return
    }
    let cancelled = false
    setLoading(true)
    void Promise.all([
      window.pageAuto.getPageTab({ id: activeId }),
      window.pageAuto.getPageTabPostLibrary({ id: activeId })
    ]).then(([nextConfig, nextLibrary]) => {
      if (cancelled) return
      if (!nextConfig) throw new Error('Page Tab không còn tồn tại.')
      setConfig({ ...nextConfig, schedules: collapseEveryDaySchedules(nextConfig.schedules) })
      setPostLibrary(nextLibrary)
      setDirtySections(new Set())
      setEditorModal(null)
      setPostLibraryOpen(false)
      setAccountPickerOpen(false)
      setError(null)
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [activeId])

  useEffect(() => {
    let cancelled = false
    const refreshRuntime = async () => {
      try {
        const runtimes = await window.pageAuto.listPageTabRotations()
        if (!cancelled) setRuntimeByTab(indexRotationRuntimes(runtimes))
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    void refreshRuntime()
    const timer = window.setInterval(() => void refreshRuntime(), 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const markDirty = (section: ConfigSection) => setDirtySections((current) => new Set(current).add(section))
  const patchConfig = (section: ConfigSection, patch: Partial<PageTabConfig>) => {
    setConfig((current) => current ? { ...current, ...patch } : current)
    markDirty(section)
  }

  const createTab = async (input: CreatePageTabInput) => {
    const created = await window.pageAuto.createPageTab(input)
    setCreateOpen(false)
    setNotice(`Đã tạo ${created.name}.`)
    await refreshTabs(created.id)
  }

  const saveSectionOnly = async (section: ConfigSection) => {
    if (!config) return
    setSavingSection(section)
    setError(null)
    try {
      const latest = await window.pageAuto.getPageTab({ id: config.id })
      if (!latest) throw new Error('Page Tab không còn tồn tại.')
      const input = toSaveInput(latest)
      if (section === 'accounts') input.accounts = toSaveInput(config).accounts
      else if (section === 'identity') { input.name = config.name; input.pageUid = config.pageUid }
      else if (section === 'rotation') input.rotation = { ...config.rotation }
      else if (section === 'schedule') input.schedules = toSaveInput(config).schedules
      else input.groupUids = parseGroupText(config.groupUids.join('\n'))

      const invalidScheduleCount = section === 'schedule' ? config.schedules.filter(scheduleIsInvalid).length : 0
      const saved = await window.pageAuto.updatePageTab({ id: config.id, config: input })
      setConfig((draft) => draft ? mergeSavedSection(draft, saved, section) : saved)
      setDirtySections((current) => { const next = new Set(current); next.delete(section); return next })
      setNotice(invalidScheduleCount > 0 ? `Đã lưu lịch; ${invalidScheduleCount} khung giờ sai được tự tắt.` : 'Đã lưu mục cấu hình.')
      await refreshTabs(saved.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSavingSection(null)
    }
  }

  const saveAll = async () => {
    if (!config) return
    setSavingSection('all')
    setError(null)
    try {
      const saved = await window.pageAuto.updatePageTab({ id: config.id, config: toSaveInput(config) })
      setConfig({ ...saved, schedules: collapseEveryDaySchedules(saved.schedules) })
      setDirtySections(new Set())
      setNotice('Đã lưu toàn bộ cấu hình Page Tab.')
      await refreshTabs(saved.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSavingSection(null)
    }
  }

  const duplicate = async () => {
    if (!config) return
    try {
      const sourceLibrary = postLibrary ?? await window.pageAuto.getPageTabPostLibrary({ id: config.id })
      const copy = await window.pageAuto.duplicatePageTab({ id: config.id })
      await window.pageAuto.savePageTabPostLibrary({
        pageTabId: copy.id,
        mode: sourceLibrary.mode,
        posts: sourceLibrary.posts.map((post, index) => ({ name: post.name, enabled: post.enabled, sortOrder: index, variants: [...post.variants], image: { ...post.image } }))
      })
      setNotice(`Đã nhân bản thành ${copy.name}, gồm cả thư viện bài viết.`)
      await refreshTabs(copy.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const deleteCurrent = async () => {
    if (!config || !window.confirm(`Xóa Page Tab “${config.name}”?`)) return
    const deletedId = config.id
    await window.pageAuto.deletePageTab({ id: deletedId })
    setNotice(`Đã xóa ${config.name}.`)
    setConfig(null)
    setPostLibrary(null)
    setRuntimeByTab((current) => {
      const next = { ...current }
      delete next[deletedId]
      return next
    })
    setActiveId(null)
    await refreshTabs()
  }

  const applyAccountSelection = (selectedIds: number[]) => {
    if (!config) return
    const selected = new Set(selectedIds)
    const currentById = new Map(config.accounts.map((item) => [item.accountId, item]))
    const next: PageTabAccountRef[] = []
    for (const item of config.accounts) if (selected.has(item.accountId)) next.push({ ...item, sortOrder: next.length })
    for (const account of accounts) if (selected.has(account.id) && !currentById.has(account.id)) next.push(accountRef(account, next.length))
    patchConfig('accounts', { accounts: next })
    setAccountPickerOpen(false)
  }

  const updateAccount = (index: number, patch: Partial<PageTabAccountRef>) => {
    if (!config) return
    patchConfig('accounts', { accounts: config.accounts.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) })
  }

  const addSchedule = () => {
    if (!config) return
    const schedule: PageTabSchedule = { id: -Date.now(), dayOfWeek: 1, startMinute: 480, endMinute: 660, enabled: true, sortOrder: config.schedules.length }
    patchConfig('schedule', { schedules: [...config.schedules, schedule] })
  }

  const updateSchedule = (index: number, patch: Partial<PageTabSchedule>) => {
    if (!config) return
    patchConfig('schedule', { schedules: config.schedules.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) })
  }

  const importGroups = async () => {
    const result = await window.pageAuto.pickPageTabTextFile()
    if (!result || !config) return
    patchConfig('groups', { groupUids: parseGroupText(result.content) })
    setNotice(`Đã nạp Group UID từ ${result.path}.`)
  }

  if (loading && tabs.length === 0) return <section className="page-tabs-empty"><strong>Đang tải Page Tabs…</strong></section>

  const runtime = activeRuntimeForPage(runtimeByTab, activeId)
  const groupCount = config ? parseGroupText(config.groupUids.join('\n')).length : 0
  const enabledAccountCount = config?.accounts.filter((item) => item.enabled).length ?? 0
  const enabledScheduleCount = config?.schedules.filter((item) => item.enabled && !scheduleIsInvalid(item)).length ?? 0
  const enabledPostCount = postLibrary?.posts.filter((item) => item.enabled).length ?? 0
  const variantCount = postLibrary?.posts.reduce((sum, item) => sum + item.variants.length, 0) ?? 0
  const imagePostCount = postLibrary?.posts.filter((item) => item.image.folderPath.trim()).length ?? 0
  const dirty = dirtySections.size > 0
  const runtimeStateByAccount = new Map((runtime?.accountStates ?? []).map((item) => [item.accountId, item]))
  const preview = runtime?.currentPostPreview ?? null
  const progress = runtimeProgressLabel(runtime)
  const currentAccount = config?.accounts.find((item) => item.accountId === runtime?.currentAccountId)

  return (
    <section className="page-tabs-manager">
      <div className="page-tabs-strip" aria-label="Danh sách Page Tabs">
        <div className="page-tabs-scroll">
          {tabs.map((tab) => {
            const tabRuntime = runtimeByTab[tab.id]
            const tabRuntimeStatus = tabRuntime?.status ?? 'idle'
            return <button type="button" key={tab.id} title={`Runtime: ${rotationRuntimeLabel(tabRuntimeStatus)}`} className={`${tab.id === activeId ? 'page-tab-chip active' : 'page-tab-chip'} runtime-${tabRuntimeStatus}`} onClick={() => {
              if (dirty && !window.confirm('Page Tab có mục chưa lưu. Chuyển tab và bỏ thay đổi?')) return
              setActiveId(tab.id)
            }}><span className="page-tab-status-dot" /><span><strong>{tab.name}</strong><small>{tab.pageUid}</small></span></button>
          })}
        </div>
        <button className="page-tab-add" type="button" onClick={() => setCreateOpen(true)}>+ Page</button>
      </div>

      {notice ? <div className="pt-notice"><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}
      {error ? <div className="page-tab-error">{error}</div> : null}

      {!config ? <div className="page-tabs-empty"><strong>Chưa có Page Tab</strong><span>Tạo tab đầu tiên để cấu hình Page UID, tài khoản, lịch, group và bài viết.</span><button className="pt-button primary" type="button" onClick={() => setCreateOpen(true)}>+ Tạo Page Tab</button></div> : (
        <div className="page-tab-workspace">
          <header className="page-tab-editor-header">
            <div><div className="page-tab-title-line"><span className="pt-status-badge">{config.status}</span>{dirty ? <span className="pt-dirty-badge">{dirtySections.size} mục chưa lưu</span> : <span className="pt-saved-badge">Đã lưu</span>}</div><h2>{config.name}</h2><p>Page UID: {config.pageUid}</p></div>
            <div className="page-tab-header-actions"><button className="pt-button secondary" type="button" onClick={() => void duplicate()}>Nhân bản</button><button className="pt-button danger" type="button" onClick={() => void deleteCurrent()}>Xóa</button><button className="pt-button primary" type="button" disabled={!dirty || savingSection !== null} onClick={() => void saveAll()}>{savingSection === 'all' ? 'Đang lưu…' : 'Lưu tất cả'}</button></div>
          </header>

          <div className="page-tab-two-column">
            <div className="page-tab-left-pane">
              <section className="pt-panel pt-account-panel pt-account-panel-tall">
                <div className="pt-panel-heading"><div><p className="eyebrow">Tài khoản</p><h3>Danh sách chạy</h3></div><div className="pt-account-heading-actions"><span className="pt-count-chip">{enabledAccountCount}/{config.accounts.length} bật</span><button className="pt-button secondary" type="button" disabled={!dirtySections.has('accounts') || savingSection !== null} onClick={() => void saveSectionOnly('accounts')}>Lưu</button><button className="pt-button primary" type="button" onClick={() => setAccountPickerOpen(true)}>Chọn tài khoản</button></div></div>
                <div className="pt-account-grid-wrap"><table className="pt-account-grid"><thead><tr><th>#</th><th>Bật</th><th>UID</th><th>Tên</th><th>TK</th><th>Hoạt động</th><th>Nhóm</th><th>Bài/lượt</th><th>Thứ tự</th><th>Xóa</th></tr></thead><tbody>
                  {config.accounts.map((account, index) => {
                    const activity = runtimeStateByAccount.get(account.accountId)
                    const activityStatus = activity?.status ?? 'not_run'
                    return <tr key={account.accountId} className={`pt-account-run-row run-${activityStatus}`} title={activity?.message ?? undefined}><td>{index + 1}</td><td><input type="checkbox" checked={account.enabled} onChange={(event) => updateAccount(index, { enabled: event.target.checked })} /></td><td className="pt-account-uid">{account.uid}</td><td>{account.name ?? '—'}</td><td><span className={`pt-account-status status-${account.status}`}>{account.status}</span></td><td className="pt-account-activity"><span className={`pt-run-status run-${activityStatus}`}>{accountRuntimeLabel(activityStatus, activity?.checkpointKind)}</span></td><td>{account.category ?? '—'}</td><td className="pt-account-posts"><input type="number" min="1" title="Để trống sẽ dùng Mặc định bài/lượt ở card Vòng chạy." placeholder={String(config.rotation.postsPerAccount)} value={account.postsPerTurn ?? ''} onChange={(event) => updateAccount(index, { postsPerTurn: event.target.value === '' ? null : Number(event.target.value) })} /></td><td className="pt-account-order"><button type="button" onClick={() => patchConfig('accounts', { accounts: moveItem(config.accounts, index, -1) })} disabled={index === 0}>↑</button><button type="button" onClick={() => patchConfig('accounts', { accounts: moveItem(config.accounts, index, 1) })} disabled={index === config.accounts.length - 1}>↓</button></td><td><button className="pt-remove-button" type="button" onClick={() => patchConfig('accounts', { accounts: config.accounts.filter((_, itemIndex) => itemIndex !== index) })}>×</button></td></tr>
                  })}
                  {config.accounts.length === 0 ? <tr><td colSpan={10} className="pt-account-empty">Tab chưa có tài khoản.</td></tr> : null}
                </tbody></table></div>
              </section>

              <section className="pt-panel pt-identity-panel pt-compact-panel">
                <div className="pt-panel-heading"><div><p className="eyebrow">Nhận diện</p><h3>Page</h3></div><button className="pt-button secondary" type="button" disabled={!dirtySections.has('identity') || savingSection !== null} onClick={() => void saveSectionOnly('identity')}>Lưu</button></div>
                <div className="pt-form-grid two"><label><span>Tên tab</span><input value={config.name} onChange={(event) => patchConfig('identity', { name: event.target.value })} /></label><label><span>Page UID</span><input value={config.pageUid} onChange={(event) => patchConfig('identity', { pageUid: event.target.value })} /></label></div>
              </section>

              <section className="pt-panel pt-rotation-panel pt-compact-panel">
                <div className="pt-panel-heading"><div><p className="eyebrow">Vòng chạy</p><h3>Số bài và thời gian nghỉ</h3></div><div className="pt-account-heading-actions"><label className="pt-count-chip" title="Bật để mỗi vòng dùng một thứ tự tài khoản ngẫu nhiên, không lặp account trong cùng vòng."><input type="checkbox" checked={(config.rotation.accountOrderMode ?? 'sequential') === 'random'} onChange={(event) => patchConfig('rotation', { rotation: { ...config.rotation, accountOrderMode: event.target.checked ? 'random' : 'sequential' } })} /> Ngẫu nhiên TK</label><button className="pt-button secondary" type="button" disabled={!dirtySections.has('rotation') || savingSection !== null} onClick={() => void saveSectionOnly('rotation')}>Lưu</button></div></div>
                <div className="pt-form-grid five pt-rotation-grid"><label title="Chỉ dùng cho account để trống cột Bài/lượt."><span>Mặc định bài/lượt</span><input type="number" min="1" value={config.rotation.postsPerAccount} onChange={(event) => patchConfig('rotation', { rotation: { ...config.rotation, postsPerAccount: Number(event.target.value) } })} /></label><label><span>Delay bài min (s)</span><input type="number" min="0" value={config.rotation.postDelayMinSeconds} onChange={(event) => patchConfig('rotation', { rotation: { ...config.rotation, postDelayMinSeconds: Number(event.target.value) } })} /></label><label><span>Delay bài max (s)</span><input type="number" min="0" value={config.rotation.postDelayMaxSeconds} onChange={(event) => patchConfig('rotation', { rotation: { ...config.rotation, postDelayMaxSeconds: Number(event.target.value) } })} /></label><label><span>Đổi account min (s)</span><input type="number" min="0" value={config.rotation.accountDelayMinSeconds} onChange={(event) => patchConfig('rotation', { rotation: { ...config.rotation, accountDelayMinSeconds: Number(event.target.value) } })} /></label><label><span>Đổi account max (s)</span><input type="number" min="0" value={config.rotation.accountDelayMaxSeconds} onChange={(event) => patchConfig('rotation', { rotation: { ...config.rotation, accountDelayMaxSeconds: Number(event.target.value) } })} /></label></div>
              </section>
            </div>

            <div className="page-tab-right-pane">
              <section className={`pt-panel pt-live-preview runtime-${runtime?.status ?? 'idle'}`}>
                <div className="pt-panel-heading"><div><p className="eyebrow">Đang xử lý</p><h3>Preview bài hiện tại</h3></div><span className="pt-live-runtime-state">{rotationRuntimeLabel(runtime?.status ?? 'idle')}{currentAccount ? ` · ${currentAccount.uid}${currentAccount.name ? ` · ${currentAccount.name}` : ''}` : ''}</span></div>
                {preview ? <>
                  <div className="pt-live-preview-meta"><span>Group <b>{preview.groupUid}</b></span>{progress ? <span>Tiến độ <b>{progress}</b></span> : null}<span>Bài <b>#{preview.postIndex + 1}</b></span><span>Biến thể <b>#{preview.variantIndex + 1}</b></span><span>Ảnh <b>{preview.imageCount}</b></span></div>
                  <p>{preview.contentPreview || '(Bài không có nội dung text)'}</p>
                </> : <div className="pt-live-preview-empty">{runtimeEmptyPreviewMessage(runtime)}</div>}
              </section>

              <section className="pt-panel pt-business-panel">
                <div className="pt-panel-heading"><div><p className="eyebrow">Cấu hình nghiệp vụ</p><h3>Đăng Nhóm</h3></div><span className="pt-business-state">Mỗi mục lưu riêng</span></div>
                <div className="pt-business-list">
                  <div className="pt-business-row"><div className="pt-business-icon">L</div><div className="pt-business-copy"><span>Lịch chạy</span><strong>{enabledScheduleCount} khung đang bật</strong><small>Ngày chạy và nhiều khung giờ trong ngày</small></div>{dirtySections.has('schedule') ? <span className="pt-business-unsaved">Chưa lưu</span> : null}<button type="button" onClick={() => setEditorModal('schedule')}>Chỉnh</button></div>
                  <div className="pt-business-row"><div className="pt-business-icon">G</div><div className="pt-business-copy"><span>Group Set</span><strong>{groupCount} group</strong><small>Nguồn Group gốc · run tự snapshot riêng</small></div>{dirtySections.has('groups') ? <span className="pt-business-unsaved">Chưa lưu</span> : null}<button type="button" onClick={() => setEditorModal('groups')}>Quản lý</button></div>
                  <div className="pt-business-row featured"><div className="pt-business-icon">B</div><div className="pt-business-copy"><span>Bài viết</span><strong>{enabledPostCount}/{postLibrary?.posts.length ?? 0} bài bật · {variantCount} biến thể</strong><small>{postLibrary?.mode === 'random' ? 'Lấy bài ngẫu nhiên' : 'Lấy bài lần lượt'} · {imagePostCount} bài có folder ảnh</small></div><button type="button" className="primary" onClick={() => setPostLibraryOpen(true)}>Quản lý bài viết</button></div>
                </div>
              </section>

              <section className="pt-panel pt-right-summary"><div><span>Accounts</span><strong>{config.accounts.length}</strong></div><div><span>Groups</span><strong>{groupCount}</strong></div><div><span>Bài viết</span><strong>{enabledPostCount}</strong></div><div><span>Schedule</span><strong>{enabledScheduleCount}</strong></div></section>
            </div>
          </div>
        </div>
      )}

      {createOpen ? <CreateTabModal onClose={() => setCreateOpen(false)} onCreate={createTab} /> : null}
      {config && accountPickerOpen ? <AccountPicker accounts={accounts} selectedIds={config.accounts.map((item) => item.accountId)} onClose={() => setAccountPickerOpen(false)} onApply={applyAccountSelection} /> : null}

      {config && editorModal === 'schedule' ? <ConfigModal eyebrow="Lịch chạy" title="Ngày và khung giờ" onClose={() => setEditorModal(null)} actions={<><button className="pt-button secondary" type="button" onClick={addSchedule}>+ Khung giờ</button><button className="pt-button primary" type="button" disabled={!dirtySections.has('schedule') || savingSection !== null} onClick={() => void saveSectionOnly('schedule')}>{savingSection === 'schedule' ? 'Đang lưu…' : 'Lưu lịch'}</button></>}>
        <div className="pt-schedule-list">{config.schedules.map((schedule, index) => <div className="pt-schedule-row" key={`${schedule.id}:${index}`}><label><span>Bật</span><input type="checkbox" checked={schedule.enabled} onChange={(event) => updateSchedule(index, { enabled: event.target.checked })} /></label><label><span>Ngày</span><select value={schedule.dayOfWeek === EVERY_DAY_SCHEDULE ? 1 : schedule.dayOfWeek} disabled={schedule.dayOfWeek === EVERY_DAY_SCHEDULE} onChange={(event) => updateSchedule(index, { dayOfWeek: Number(event.target.value) })}>{dayLabels.map((label, day) => <option key={label} value={day}>{label}</option>)}</select><span className="pt-schedule-every-day"><input type="checkbox" checked={schedule.dayOfWeek === EVERY_DAY_SCHEDULE} onChange={(event) => updateSchedule(index, { dayOfWeek: event.target.checked ? EVERY_DAY_SCHEDULE : 1 })} /> Mỗi ngày</span></label><label><span>Từ</span><input type="time" value={minutesToTime(schedule.startMinute)} onChange={(event) => updateSchedule(index, { startMinute: timeToMinutes(event.target.value) })} /></label><label><span>Đến</span><input type="time" value={minutesToTime(schedule.endMinute)} onChange={(event) => updateSchedule(index, { endMinute: timeToMinutes(event.target.value) })} /></label><button className="pt-remove-button" type="button" onClick={() => patchConfig('schedule', { schedules: config.schedules.filter((_, itemIndex) => itemIndex !== index) })}>Xóa</button></div>)}{config.schedules.length === 0 ? <div className="pt-empty-row">Chưa có lịch. Tab vẫn có thể chạy thủ công.</div> : null}</div>
      </ConfigModal> : null}

      {config && editorModal === 'groups' ? <ConfigModal eyebrow="Group Set" title="Danh sách Group UID" onClose={() => setEditorModal(null)} actions={<><button className="pt-button secondary" type="button" onClick={() => void importGroups()}>Import TXT/CSV</button><button className="pt-button primary" type="button" disabled={!dirtySections.has('groups') || savingSection !== null} onClick={() => void saveSectionOnly('groups')}>{savingSection === 'groups' ? 'Đang lưu…' : 'Lưu Group'}</button></>}>
        <div className="pt-modal-toolbar"><span>{groupCount} group sau khi trim + chống trùng</span></div><textarea className="pt-source-textarea pt-modal-textarea" rows={18} value={config.groupUids.join('\n')} onChange={(event) => patchConfig('groups', { groupUids: event.target.value.split(/\r?\n/) })} placeholder={'123456789\n987654321\n...'} /><p className="pt-help">Danh sách gốc luôn được giữ; mỗi phiên chạy clone sang run_items.</p>
      </ConfigModal> : null}

      {config && postLibrary && postLibraryOpen ? <PostLibraryModal pageTabId={config.id} initialLibrary={postLibrary} onClose={() => setPostLibraryOpen(false)} onSaved={(saved) => { setPostLibrary(saved); setNotice('Đã lưu thư viện bài viết.'); void refreshTabs(config.id) }} /> : null}
    </section>
  )
}
