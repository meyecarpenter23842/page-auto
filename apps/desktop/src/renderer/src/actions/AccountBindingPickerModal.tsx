import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { ACCOUNT_STATUSES, type AccountRecord, type AccountStatus } from '../../../shared/accounts'
import { AccountSelectionMenu } from '../accounts/AccountSelectionMenu'
import { useExcelRowRange } from '../accounts/accountTableSelection'
import { accountStatusLabels } from '../accounts/accountManagerModel'
import '../page-tabs/pageTabs.css'
import '../page-tabs/pageTabsWorkspace.css'
import '../page-tabs/pageAccountParity.css'

interface AccountBindingPickerModalProps {
  accounts: AccountRecord[]
  selectedIds: ReadonlySet<number>
  onApply: (accountIds: number[]) => void
  onClose: () => void
  contextLabel?: string
}

type AccountPickerStatus = AccountStatus | 'all'
type PickerContextMenu = { x: number; y: number; accountId: number } | null

export function AccountBindingPickerModal({ accounts, selectedIds, onApply, onClose, contextLabel = 'Tương tác' }: AccountBindingPickerModalProps) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<AccountPickerStatus>('all')
  const [category, setCategory] = useState('all')
  const [selected, setSelected] = useState(() => new Set(selectedIds))
  const [contextMenu, setContextMenu] = useState<PickerContextMenu>(null)

  const categories = useMemo(() => Array.from(new Set(
    accounts
      .map((account) => account.category?.trim())
      .filter((value): value is string => Boolean(value))
  )).sort(), [accounts])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return accounts.filter((account) => {
      if (status !== 'all' && account.status !== status) return false
      if (category !== 'all' && (account.category ?? '') !== category) return false
      return !query || [account.uid, account.username, account.name, account.email, account.note, account.category]
        .some((value) => value?.toLowerCase().includes(query))
    })
  }, [accounts, category, search, status])
  const excelRange = useExcelRowRange(filtered.map((account) => account.id))

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

  const toggle = (id: number, checked: boolean) => setSelected((current) => {
    const next = new Set(current)
    if (checked) next.add(id)
    else next.delete(id)
    return next
  })

  const selectRange = () => {
    setSelected((current) => new Set([...current, ...excelRange.rangeIds]))
    setContextMenu(null)
  }

  const selectAllFiltered = () => {
    setSelected((current) => new Set([...current, ...filtered.map((account) => account.id)]))
    setContextMenu(null)
  }

  const clearSelection = () => {
    setSelected(new Set())
    setContextMenu(null)
  }

  const openContextMenu = (event: MouseEvent<HTMLTableRowElement>, accountId: number) => {
    event.preventDefault()
    event.stopPropagation()
    excelRange.ensureContextRow(accountId)
    setContextMenu({ x: event.clientX, y: event.clientY, accountId })
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every((account) => selected.has(account.id))

  return (
    <div className="page-tab-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="page-tab-modal pt-account-picker-modal" role="dialog" aria-modal="true" aria-label="Chọn tài khoản" onMouseDown={(event) => event.stopPropagation()}>
        <div className="page-tab-modal-header"><div><p className="eyebrow">Account Manager</p><h2>Chọn tài khoản cho {contextLabel}</h2></div><button type="button" className="page-tab-icon-button" onClick={onClose}>×</button></div>
        <div className="pt-account-picker-filters">
          <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm UID, tên, email, note…" />
          <select value={status} onChange={(event) => setStatus(event.target.value as AccountPickerStatus)}><option value="all">Tất cả trạng thái</option>{ACCOUNT_STATUSES.map((item) => <option key={item} value={item}>{accountStatusLabels[item]}</option>)}</select>
          <select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">Tất cả category</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <button className="pt-button secondary" type="button" onClick={selectAllFiltered}>Chọn đang lọc</button>
        </div>
        <div className="pt-account-picker-grid-wrap">
          <table className="pt-account-picker-grid"><thead><tr><th className="picker-check"><input type="checkbox" aria-label="Chọn tất cả tài khoản đang lọc" checked={allFilteredSelected} onChange={(event) => setSelected((current) => {
            const next = new Set(current)
            for (const account of filtered) {
              if (event.target.checked) next.add(account.id)
              else next.delete(account.id)
            }
            return next
          })} /></th><th>UID / UserName</th><th>Tên</th><th>Trạng thái</th><th>Category</th><th>Note</th></tr></thead><tbody>
            {filtered.map((account) => {
              const checked = selected.has(account.id)
              const ranged = excelRange.rangeIds.has(account.id)
              return <tr
                key={account.id}
                className={`${checked ? 'checked-row ' : ''}${ranged ? 'range-row' : ''}`.trim()}
                onPointerDown={(event) => excelRange.onRowPointerDown(event, account.id)}
                onPointerEnter={() => excelRange.onRowPointerEnter(account.id)}
                onContextMenu={(event) => openContextMenu(event, account.id)}
              ><td className="picker-check"><input type="checkbox" checked={checked} onChange={(event) => toggle(account.id, event.target.checked)} onPointerDown={(event) => event.stopPropagation()} /></td><td className="picker-uid">{account.uid}{account.username ? ` / ${account.username}` : ''}</td><td>{account.name ?? '—'}</td><td><span className={`status-text status-${account.status}`}>{accountStatusLabels[account.status]}</span></td><td>{account.category ?? '—'}</td><td>{account.note ?? '—'}</td></tr>
            })}
            {filtered.length === 0 ? <tr><td colSpan={6} className="pt-account-empty">Không có tài khoản phù hợp.</td></tr> : null}
          </tbody></table>
        </div>
        <div className="page-tab-modal-actions"><span className="pt-modal-save-note">Đã tích {selected.size}/{accounts.length} · phủ {excelRange.rangeIds.size}</span><button className="pt-button secondary" type="button" onClick={onClose}>Hủy</button><button className="pt-button primary" type="button" onClick={() => onApply(accounts.filter((account) => selected.has(account.id)).map((account) => account.id))}>Áp dụng</button></div>
      </section>
      {contextMenu ? <AccountSelectionMenu
        x={contextMenu.x}
        y={contextMenu.y}
        checkedCount={selected.size}
        rangeCount={excelRange.rangeIds.size}
        totalCount={filtered.length}
        onCheckRange={selectRange}
        onCheckAll={selectAllFiltered}
        onClearChecked={clearSelection}
      /> : null}
    </div>
  )
}
