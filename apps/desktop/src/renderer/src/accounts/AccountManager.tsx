import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent
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
import { DEFAULT_CHANGE_INFO_WORKSPACE_DRAFT, serializeChangeInfoWorkspaceDraft } from '../../../shared/changeInfoWorkspace'
import { openAccountProfilesBatch } from './accountProfileBatch'
import { AccountColumnManager as ColumnManager } from './AccountColumnManager'
import { AccountEditor } from './AccountEditor'
import { AccountGroupManagerDialog, AccountGroupPicker } from './AccountGroupDialogs'
import { AccountImportDialog as ImportDialog } from './AccountImportDialog'
import { AccountSelectionMenu } from './AccountSelectionMenu'
import { useExcelRowRange } from './accountTableSelection'
import {
  ACCOUNT_RUNTIME_REFRESH_MS,
  EMPTY_GROUP_OVERVIEW,
  UNGROUPED_CATEGORY_FILTER,
  accountStatusLabels,
  columnById,
  defaultLayout,
  formatCellValue,
  maskSecret,
  normalizeBulkUidFilter,
  normalizeLayout,
  type ColumnId,
  type ContextMenuState,
  type GridColumn
} from './accountManagerModel'
import { checkLiveSummaryBucket } from './checkLiveSummary'
import { Checkpoint282Dialog } from './Checkpoint282Dialog'
import { Checkpoint956Dialog } from './Checkpoint956Dialog'
import './accounts.css'
import './accountEnhancements.css'

interface AccountManagerProps {
  onOpenChangeInfoWorkspace?: (workspaceId: number) => void
}

function BulkUidFilterDialog({
  initialUids,
  onApply,
  onClose
}: {
  initialUids: readonly string[]
  onApply: (uids: string[]) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initialUids.join('\n'))
  const normalized = useMemo(() => normalizeBulkUidFilter(value), [value])
  const hasActiveFilter = initialUids.length > 0

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal bulk-uid-filter-modal" role="dialog" aria-modal="true" aria-label="Lọc UID hàng loạt" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Lọc UID hàng loạt</h2>
            <p>Mỗi dòng 1 UID. Không cần dấu phân cách.</p>
          </div>
          <button className="icon-button" type="button" aria-label="Đóng" onClick={onClose}>×</button>
        </div>
        <textarea
          className="bulk-uid-filter-textarea"
          value={value}
          autoFocus
          spellCheck={false}
          placeholder={'100001234567890\n100009876543210\n100005555555555'}
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="bulk-uid-filter-summary">
          <span>{normalized.length} UID</span>
          <small>Dòng trống và UID trùng được tự bỏ.</small>
        </div>
        <div className="modal-actions bulk-uid-filter-actions">
          <button className="button secondary" type="button" disabled={!hasActiveFilter} onClick={() => onApply([])}>Xóa lọc</button>
          <span />
          <button className="button secondary" type="button" onClick={onClose}>Hủy</button>
          <button className="button primary" type="button" disabled={normalized.length === 0} onClick={() => onApply(normalized)}>Áp dụng ({normalized.length})</button>
        </div>
      </section>
    </div>
  )
}

export function AccountManager({ onOpenChangeInfoWorkspace }: AccountManagerProps = {}) {
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [bulkUidFilter, setBulkUidFilter] = useState<string[]>([])
  const [bulkUidFilterOpen, setBulkUidFilterOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | AccountRecord['status']>('all')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [groupOverview, setGroupOverview] = useState<AccountGroupOverview>(EMPTY_GROUP_OVERVIEW)
  const [groupManagerOpen, setGroupManagerOpen] = useState(false)
  const [groupPickerOpen, setGroupPickerOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [layout, setLayout] = useState<AccountColumnLayout>(defaultLayout)
  const [columnManagerOpen, setColumnManagerOpen] = useState(false)
  const [editorAccount, setEditorAccount] = useState<AccountRecord | null | undefined>(undefined)
  const [importOperation, setImportOperation] = useState<AccountImportOperation | null>(null)
  const [presets, setPresets] = useState<ImportPreset[]>([])
  const [sort, setSort] = useState<{ id: ColumnId; direction: 'asc' | 'desc' }>({ id: 'id', direction: 'desc' })
  const [revealedSecrets, setRevealedSecrets] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  const [openingProfiles, setOpeningProfiles] = useState(false)
  const [checkingLive, setCheckingLive] = useState(false)
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
      const uidFilter = bulkUidFilter.length > 0 ? new Set(bulkUidFilter) : null
      const filtered = uidFilter
        ? visible.filter((account) => uidFilter.has(account.uid.trim()))
        : visible
      setAccounts(filtered)
      setSelectedIds((current) => new Set([...current].filter((id) => filtered.some((account) => account.id === id))))
    } finally {
      if (!background) setLoading(false)
    }
  }, [search, statusFilter, categoryFilter, bulkUidFilter])

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
  const excelRange = useExcelRowRange(sortedAccounts.map((account) => account.id))

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

  const selectAllFiltered = () => {
    setSelectedIds(new Set(sortedAccounts.map((account) => account.id)))
    setContextMenu(null)
  }

  const selectRange = () => {
    setSelectedIds((current) => new Set([...current, ...excelRange.rangeIds]))
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

  const openChangeInfo = async () => {
    if (selected.length === 0) return
    setContextMenu(null)
    try {
      const existing = await window.pageAuto.listActionWorkspaces()
      const used = new Set(existing.filter((item) => item.type === 'change_info').map((item) => item.label))
      let index = 1
      while (used.has(index === 1 ? 'Sửa thông tin' : `Sửa thông tin ${index}`)) index += 1
      const label = index === 1 ? 'Sửa thông tin' : `Sửa thông tin ${index}`
      const created = await window.pageAuto.createActionWorkspace({
        type: 'change_info',
        label,
        configJson: serializeChangeInfoWorkspaceDraft(DEFAULT_CHANGE_INFO_WORKSPACE_DRAFT),
        accounts: selected.map((account) => ({ accountId: account.id, enabled: true }))
      })
      setNotice(`Đã tạo ${created.label} cho ${selected.length} tài khoản.`)
      onOpenChangeInfoWorkspace?.(created.id)
    } catch (error) {
      setNotice(`Không mở được Sửa thông tin: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const openProfile = async (openManagerAfter = false) => {
    if (selected.length === 0 || openingProfiles || checkingLive) return
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
      const dock = openManagerAfter && started + alreadyOpen > 0
        ? await window.pageAuto.openAccountBrowserDock()
        : null
      setNotice(
        `Đã xử lý ${outcomes.length} Chrome: mở mới ${started}, đang mở ${alreadyOpen}, lỗi ${failed.length}`
        + (firstFailure ? ` · ${firstFailure.uid}: ${firstFailure.message ?? 'lỗi không xác định'}` : '.')
        + (dock ? ` · ${dock.message}` : '')
      )
      await loadAccounts()
    } finally {
      setOpeningProfiles(false)
    }
  }

  const checkLiveSelected = async () => {
    if (selected.length === 0 || openingProfiles || checkingLive) return
    const targets = selected.map((account) => ({ id: account.id, uid: account.uid }))
    setCheckingLive(true)
    setContextMenu(null)
    try {
      const outcomes = await Promise.all(targets.map(async (target) => {
        try {
          const result = await window.pageAuto.openAccountProfile({ accountId: target.id, checkLive: true })
          return {
            uid: target.uid,
            status: result.status,
            sessionStatus: result.sessionStatus,
            message: result.message ?? null
          }
        } catch (error) {
          return {
            uid: target.uid,
            status: 'error' as const,
            sessionStatus: undefined,
            message: error instanceof Error ? error.message : String(error)
          }
        }
      }))
      const live = outcomes.filter((item) => item.status !== 'error' && checkLiveSummaryBucket(item.sessionStatus) === 'live')
      const needsAttention = outcomes.filter((item) => item.status !== 'error' && checkLiveSummaryBucket(item.sessionStatus) === 'problem')
      const failed = outcomes.filter((item) => item.status === 'error')
      const unknown = outcomes.filter((item) => item.status !== 'error' && checkLiveSummaryBucket(item.sessionStatus) === 'unknown')
      const firstIssue = outcomes.find((item) => item.status === 'error' || checkLiveSummaryBucket(item.sessionStatus) !== 'live')
      const firstIssueLabel = firstIssue?.sessionStatus ? accountStatusLabels[firstIssue.sessionStatus] : null
      setNotice(
        `Check Live ${outcomes.length} tài khoản: hoạt động ${live.length}, cần xử lý ${needsAttention.length}, chưa xác định ${unknown.length}, lỗi ${failed.length}.`
        + (firstIssue ? ` · ${firstIssue.uid}: ${firstIssueLabel ? `${firstIssueLabel} · ` : ''}${firstIssue.message ?? 'chưa xác định trạng thái'}` : '')
      )
      await loadAccounts()
    } finally {
      setCheckingLive(false)
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
    excelRange.ensureContextRow(account.id)
    setContextMenu({ x: event.clientX, y: event.clientY })
  }

  const openBulkUidFilter = () => {
    setContextMenu(null)
    setBulkUidFilterOpen(true)
  }

  const applyBulkUidFilter = (uids: string[]) => {
    setBulkUidFilter(uids)
    setBulkUidFilterOpen(false)
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
            <button className="button secondary" type="button" disabled={selectedIds.size === 0} onClick={() => void openChangeInfo()}>Sửa thông tin</button>
            <button className="button secondary" type="button" disabled={selectedIds.size === 0 || openingProfiles || checkingLive} onClick={() => void openProfile(true)}>Cửa sổ Chrome</button>
            <button className="button secondary" type="button" disabled={selectedIds.size === 0 || openingProfiles || checkingLive} onClick={() => void checkLiveSelected()}>{checkingLive ? 'Đang Check Live…' : 'Check Live'}</button>
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
          <button
            className={`button secondary bulk-uid-filter-button${bulkUidFilter.length ? ' active' : ''}`}
            type="button"
            title="Lọc UID hàng loạt"
            aria-label="Lọc UID hàng loạt"
            onClick={openBulkUidFilter}
          >UID{bulkUidFilter.length ? ` · ${bulkUidFilter.length}` : ''}</button>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}><option value="all">Tất cả trạng thái</option>{ACCOUNT_STATUSES.map((status) => <option key={status} value={status}>{accountStatusLabels[status]}</option>)}</select>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">Tất cả nhóm ({groupOverview.groups.length})</option>
            <option value={UNGROUPED_CATEGORY_FILTER}>Chưa gán nhóm ({groupOverview.ungroupedCount})</option>
            {groupOverview.groups.map((group) => <option key={group.id} value={group.name}>{group.name} ({group.accountCount})</option>)}
          </select>
          <span className="grid-state">{loading ? 'Đang tải…' : `${sortedAccounts.length}/${groupOverview.totalAccounts} tài khoản${bulkUidFilter.length ? ` · lọc UID ${bulkUidFilter.length}` : ''} · tích ${selectedIds.size} · phủ ${excelRange.rangeIds.size}`}</span>
        </div>

        {notice ? <div className="notice-bar"><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}

        <div className="data-grid-wrap">
          <table className="account-grid">
            <thead><tr>
              <th className="select-column"><input type="checkbox" aria-label="Chọn tất cả" checked={sortedAccounts.length > 0 && sortedAccounts.every((account) => selectedIds.has(account.id))} onChange={(e) => setSelectedIds(e.target.checked ? new Set(sortedAccounts.map((account) => account.id)) : new Set())} /></th>
              {visibleColumns.map((column) => <th key={column.id} style={{ width: layout.widths[column.id], minWidth: layout.widths[column.id] }}><button type="button" onClick={() => toggleSort(column.id)}>{column.label}<span>{sort.id === column.id ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}</span></button></th>)}
            </tr></thead>
            <tbody>
              {sortedAccounts.map((account) => {
                const checked = selectedIds.has(account.id)
                const ranged = excelRange.rangeIds.has(account.id)
                return (
                  <tr
                    key={account.id}
                    className={`${checked ? 'checked-row ' : ''}${ranged ? 'range-row' : ''}`.trim()}
                    onPointerDown={(event) => excelRange.onRowPointerDown(event, account.id)}
                    onPointerEnter={() => excelRange.onRowPointerEnter(account.id)}
                    onContextMenu={(event) => openContextMenu(account, event)}
                    onDoubleClick={() => setEditorAccount(account)}
                  >
                    <td className="select-column">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => setAccountSelected(account.id, event.target.checked)}
                        onPointerDown={(event) => event.stopPropagation()}
                      />
                    </td>
                    {visibleColumns.map((column) => <td key={column.id} style={{ width: layout.widths[column.id], maxWidth: layout.widths[column.id] }}>{renderCell(account, column)}</td>)}
                  </tr>
                )
              })}
              {!loading && sortedAccounts.length === 0 ? <tr><td className="empty-grid" colSpan={visibleColumns.length + 1}>Chưa có tài khoản phù hợp bộ lọc. Hãy nhập hoặc thêm tài khoản để bắt đầu.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      {contextMenu ? (
        <AccountSelectionMenu
          x={contextMenu.x}
          y={contextMenu.y}
          checkedCount={selectedIds.size}
          rangeCount={excelRange.rangeIds.size}
          totalCount={sortedAccounts.length}
          onCheckRange={selectRange}
          onCheckAll={selectAllFiltered}
          onClearChecked={clearSelection}
        >
          <button type="button" disabled={selected.length !== 1} onClick={() => { setEditorAccount(selected[0] ?? null); setContextMenu(null) }}>Sửa tài khoản</button>
          <button type="button" disabled={selectedIds.size === 0} onClick={() => void openChangeInfo()}>Sửa thông tin…</button>
          <button type="button" disabled={selectedIds.size === 0 || openingProfiles || checkingLive} onClick={() => void openProfile()}>{openingProfiles ? 'Đang mở…' : selected.length > 1 ? `Mở ${selected.length} Chrome` : 'Mở Chrome'}</button>
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
          <button type="button" disabled={selectedIds.size === 0 || openingProfiles || checkingLive} onClick={() => void checkLiveSelected()}>{checkingLive ? 'Đang Check Live…' : 'Check Live'}</button>
          <button type="button" disabled={selectedIds.size === 0} onClick={openGroupPicker}>Gán / chuyển / bỏ nhóm…</button>
          <button type="button" disabled={selectedIds.size === 0} onClick={() => void copySelectedUids()}>Sao chép UID</button>
          <button type="button" onClick={openBulkUidFilter}>Lọc UID hàng loạt…</button>
          <div className="context-menu-separator" />
          <button className="context-danger" type="button" disabled={selectedIds.size === 0} onClick={() => void deleteSelected()}>Xóa tài khoản</button>
        </AccountSelectionMenu>
      ) : null}

      {bulkUidFilterOpen ? (
        <BulkUidFilterDialog
          initialUids={bulkUidFilter}
          onApply={applyBulkUidFilter}
          onClose={() => setBulkUidFilterOpen(false)}
        />
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
      {importOperation ? (
        <ImportDialog
          operation={importOperation}
          presets={presets}
          {...(categoryFilter && categoryFilter !== UNGROUPED_CATEGORY_FILTER ? { initialGroupName: categoryFilter } : {})}
          onClose={() => setImportOperation(null)}
          onImported={(result, operation) => void onImportComplete(result, operation)}
          onPresetSaved={(preset) => setPresets((current) => [...current.filter((item) => item.id !== preset.id), preset].sort((a, b) => a.name.localeCompare(b.name)))}
        />
      ) : null}
    </section>
  )
}
