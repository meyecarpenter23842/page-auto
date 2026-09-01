import {
  useEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { ACCOUNT_STATUSES, type AccountRecord, type AccountStatus } from '../../../shared/accounts'
import { accountStatusLabels } from '../accounts/accountManagerModel'
import '../page-tabs/pageTabs.css'
import '../page-tabs/pageTabsWorkspace.css'
import '../page-tabs/pageAccountParity.css'

interface AccountBindingPickerModalProps {
  accounts: AccountRecord[]
  selectedIds: ReadonlySet<number>
  onApply: (accountIds: number[]) => void
  onClose: () => void
}

type AccountPickerStatus = AccountStatus | 'all'

export function AccountBindingPickerModal({ accounts, selectedIds, onApply, onClose }: AccountBindingPickerModalProps) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<AccountPickerStatus>('all')
  const [category, setCategory] = useState('all')
  const [selected, setSelected] = useState(() => new Set(selectedIds))
  const [paintValue, setPaintValue] = useState<boolean | null>(null)

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

  const toggle = (id: number, checked: boolean) => setSelected((current) => {
    const next = new Set(current)
    if (checked) next.add(id)
    else next.delete(id)
    return next
  })

  const beginPaint = (event: ReactPointerEvent<HTMLElement>, accountId: number) => {
    if (event.button !== 0 || event.detail > 1) return
    event.preventDefault()
    const value = !selected.has(accountId)
    toggle(accountId, value)
    setPaintValue(value)
  }

  const paintRow = (accountId: number) => {
    if (paintValue === null) return
    toggle(accountId, paintValue)
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every((account) => selected.has(account.id))

  return (
    <div className="page-tab-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="page-tab-modal pt-account-picker-modal" role="dialog" aria-modal="true" aria-label="Chọn tài khoản" onMouseDown={(event) => event.stopPropagation()}>
        <div className="page-tab-modal-header"><div><p className="eyebrow">Account Manager</p><h2>Chọn tài khoản cho Tương tác</h2></div><button type="button" className="page-tab-icon-button" onClick={onClose}>×</button></div>
        <div className="pt-account-picker-filters">
          <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm UID, tên, email, note…" />
          <select value={status} onChange={(event) => setStatus(event.target.value as AccountPickerStatus)}><option value="all">Tất cả trạng thái</option>{ACCOUNT_STATUSES.map((item) => <option key={item} value={item}>{accountStatusLabels[item]}</option>)}</select>
          <select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">Tất cả category</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <button className="pt-button secondary" type="button" onClick={() => setSelected((current) => new Set([...current, ...filtered.map((item) => item.id)]))}>Chọn đang lọc</button>
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
            {filtered.map((account) => <tr
              key={account.id}
              className={selected.has(account.id) ? 'selected' : ''}
              onPointerDown={(event) => {
                const target = event.target as HTMLElement
                if (target.closest('input,button,select,a')) return
                beginPaint(event, account.id)
              }}
              onPointerEnter={() => paintRow(account.id)}
            ><td className="picker-check"><input type="checkbox" checked={selected.has(account.id)} onChange={() => undefined} onPointerDown={(event) => { event.stopPropagation(); beginPaint(event, account.id) }} /></td><td className="picker-uid">{account.uid}{account.username ? ` / ${account.username}` : ''}</td><td>{account.name ?? '—'}</td><td><span className={`status-text status-${account.status}`}>{accountStatusLabels[account.status]}</span></td><td>{account.category ?? '—'}</td><td>{account.note ?? '—'}</td></tr>)}
            {filtered.length === 0 ? <tr><td colSpan={6} className="pt-account-empty">Không có tài khoản phù hợp.</td></tr> : null}
          </tbody></table>
        </div>
        <div className="page-tab-modal-actions"><span className="pt-modal-save-note">Đã chọn {selected.size}/{accounts.length}</span><button className="pt-button secondary" type="button" onClick={onClose}>Hủy</button><button className="pt-button primary" type="button" onClick={() => onApply(accounts.filter((account) => selected.has(account.id)).map((account) => account.id))}>Áp dụng</button></div>
      </section>
    </div>
  )
}
