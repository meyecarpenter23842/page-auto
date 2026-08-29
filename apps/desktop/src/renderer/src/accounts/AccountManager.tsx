import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import {
  ACCOUNT_STATUSES,
  type AccountColumnLayout,
  type AccountImportOperation,
  type AccountImportResult,
  type AccountRecord,
  type ImportPreset
} from '../../../shared/accounts'
import type { AccountGroupOverview } from '../../../shared/accountGroups'
import { openAccountProfilesBatch } from './accountProfileBatch'
import { AccountColumnManager as ColumnManager } from './AccountColumnManager'
import { AccountEditor } from './AccountEditor'
import { AccountGroupManagerDialog, AccountGroupPicker } from './AccountGroupDialogs'
import { AccountImportDialog as ImportDialog } from './AccountImportDialog'
import {
  ACCOUNT_RUNTIME_REFRESH_MS,
  EMPTY_GROUP_OVERVIEW,
  UNGROUPED_CATEGORY_FILTER,
  accountStatusLabels,
  columnById,
  defaultLayout,
  formatCellValue,
  maskSecret,
  normalizeLayout,
  type ColumnId,
  type ContextMenuState,
  type GridColumn
} from './accountManagerModel'
import { Checkpoint282Dialog } from './Checkpoint282Dialog'
import { Checkpoint956Dialog } from './Checkpoint956Dialog'
import './accounts.css'
import './accountEnhancements.css'

export function AccountManager() {
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | AccountRecord['status']>('all')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [groupOverview, setGroupOverview] = useState<AccountGroupOverview>(EMPTY_GROUP_OVERVIEW)
  const [groupManagerOpen, setGroupManagerOpen] = useState(false)
  const [groupPickerOpen, setGroupPickerOpen] = useState(false)
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
      const next = await window.pageAuto.listAccounts({
        search,
        status: statusFilter,
        category: categoryFilter === UNGROUPED_CATEGORY_FILTER ? '' : categoryFilter
      })
      const visible = categoryFilter === UNGROUPED_CATEGORY_FILTER
        ? next.filter((account) => !account.category?.trim())
        : next
      setAccounts(visible)
      setSelectedIds((current) => new Set([...current].filter((id) => visible.some((account) => account.id === id))))
    } finally {
      if (!background) setLoading(false)
    }
  }, [search, statusFilter, categoryFilter])

  const loadGroups = useCallback(async () => {
    const next = await window.pageAuto.getAccountGroupOverview()
    setGroupOverview(next)
    return next
  }, [])

  const refreshAccountsAndGroups = useCallback(async () => {
    await loadGroups()
    await loadAccounts()
  }, [loadAccounts, loadGroups])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAccounts(), 180)
    return () => window.clearTimeout(timer)
  }, [loadAccounts])

  useEffect(() => {
    const timer = window.setInterval(() => void loadAccounts(true), ACCOUNT_RUNTIME_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [loadAccounts])

  useEffect(() => {
    void Promise.all([
      window.pageAuto.getAccountColumnLayout(),
      window.pageAuto.listImportPresets(),
      window.pageAuto.getAccountGroupOverview()
    ]).then(([savedLayout, savedPresets, savedGroupOverview]) => {
      setLayout(normalizeLayout(savedLayout))
      setPresets(savedPresets)
      setGroupOverview(savedGroupOverview)
    })
  }, [])

  useEffect(() => {
    if (!categoryFilter || categoryFilter === UNGROUPED_CATEGORY_FILTER) return
    if (!groupOverview.groups.some((group) => group.name === categoryFilter)) setCategoryFilter('')
  }, [categoryFilter, groupOverview.groups])

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

  const selected = accounts.filter((account) => selectedIds.has(account.id))
  const selectedGroupName = useMemo(() => {
    if (selected.length === 0) return null
    const first = selected[0]?.category ?? null
    return selected.every((account) => (account.category ?? null) === first) ? first : null
  }, [selected])

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
    await refreshAccountsAndGroups()
  }

  const openGroupPicker = () => {
    if (selected.length === 0) return
    setContextMenu(null)
    setGroupPickerOpen(true)
  }

  const assignSelectedGroup = async (groupId: number | null, groupName: string | null) => {
    const count = await window.pageAuto.assignAccountsToGroup({ accountIds: selected.map((account) => account.id), groupId })
    setNotice(groupId === null
      ? `Đã bỏ nhóm cho ${count} tài khoản.`
      : `Đã chuyển ${count} tài khoản vào nhóm “${groupName ?? ''}”.`)
    await refreshAccountsAndGroups()
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
    await refreshAccountsAndGroups()
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
            <button className="button secondary" type="button" onClick={() => setGroupManagerOpen(true)}>Quản lý nhóm ({groupOverview.groups.length})</button>
            <button className="button secondary" type="button" disabled={selectedIds.size === 0} onClick={openGroupPicker}>Gán nhóm</button>
            <div className="column-settings-anchor">
              <button className="button secondary" type="button" onClick={() => setColumnManagerOpen((value) => !value)}>Cột</button>
              {columnManagerOpen ? <ColumnManager layout={layout} onChange={persistLayout} onClose={() => setColumnManagerOpen(false)} /> : null}
            </div>
          </div>
        </div>

        <div className="filter-row">
          <input className="search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm UID, tên đăng nhập, tên, email, ghi chú…" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}><option value="all">Tất cả trạng thái</option>{ACCOUNT_STATUSES.map((status) => <option key={status} value={status}>{accountStatusLabels[status]}</option>)}</select>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">Tất cả nhóm ({groupOverview.groups.length})</option>
            <option value={UNGROUPED_CATEGORY_FILTER}>Chưa gán nhóm ({groupOverview.ungroupedCount})</option>
            {groupOverview.groups.map((group) => <option key={group.id} value={group.name}>{group.name} ({group.accountCount})</option>)}
          </select>
          <span className="grid-state">{loading ? 'Đang tải…' : `${sortedAccounts.length}/${groupOverview.totalAccounts} tài khoản · ${groupOverview.groups.length} nhóm · đã chọn ${selectedIds.size}`}</span>
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
          <button type="button" disabled={selectedIds.size === 0} onClick={openGroupPicker}>Gán / chuyển / bỏ nhóm…</button>
          <button type="button" disabled={selectedIds.size === 0} onClick={() => void copySelectedUids()}>Sao chép UID</button>
          <div className="context-menu-separator" />
          <button type="button" disabled={sortedAccounts.length === 0} onClick={selectAllFiltered}>Chọn tất cả đang lọc</button>
          <button type="button" disabled={selectedIds.size === 0} onClick={clearSelection}>Bỏ chọn tất cả</button>
          <div className="context-menu-separator" />
          <button className="context-danger" type="button" disabled={selectedIds.size === 0} onClick={() => void deleteSelected()}>Xóa tài khoản</button>
        </div>
      ) : null}

      {groupPickerOpen ? (
        <AccountGroupPicker
          overview={groupOverview}
          selectedCount={selected.length}
          currentGroupName={selectedGroupName}
          onClose={() => setGroupPickerOpen(false)}
          onAssigned={assignSelectedGroup}
        />
      ) : null}
      {groupManagerOpen ? <AccountGroupManagerDialog overview={groupOverview} onClose={() => setGroupManagerOpen(false)} onChanged={refreshAccountsAndGroups} /> : null}
      {checkpoint282Accounts ? <Checkpoint282Dialog accounts={checkpoint282Accounts} onClose={() => setCheckpoint282Accounts(null)} /> : null}
      {checkpoint956Accounts ? <Checkpoint956Dialog accounts={checkpoint956Accounts} onClose={() => setCheckpoint956Accounts(null)} /> : null}
      {editorAccount !== undefined ? <AccountEditor account={editorAccount} onClose={() => setEditorAccount(undefined)} onSaved={async () => { setEditorAccount(undefined); setNotice('Đã lưu tài khoản.'); await refreshAccountsAndGroups() }} /> : null}
      {importOperation ? <ImportDialog operation={importOperation} presets={presets} onClose={() => setImportOperation(null)} onImported={(result, operation) => void onImportComplete(result, operation)} onPresetSaved={(preset) => setPresets((current) => [...current.filter((item) => item.id !== preset.id), preset].sort((a, b) => a.name.localeCompare(b.name)))} /> : null}
    </section>
  )
}
